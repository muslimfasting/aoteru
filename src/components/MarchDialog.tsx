'use client';

/**
 * Order an army to march: reinforce one of your own provinces or attack.
 *
 * The player chooses where from, where to and how many soldiers; the server
 * previews the route, travel time and supplies (POST /api/army/preview) and
 * decides whether the order is a move or an attack.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArmyOverviewResponse, MarchPreviewResponse, MarchResponse, WorldMapResponse } from '@/game/api';
import { UNITS, UNIT_TYPES, armyPower, emptyUnits, totalUnits, type UnitCounts } from '@/game/config';
import { PROVINCE_BY_CODE } from '@/game/map';
import { ApiError, apiPost, errorMessage, newIdempotencyKey } from '@/lib/api';
import { EVENTS } from '@/lib/events';
import { fmt, fmtDuration } from '@/lib/format';
import { useAction, useApi, useDebounced } from '@/lib/hooks';
import { useGame } from '@/lib/game-context';
import { ActionButton, Dialog, ErrorState, LoadingState, NumberStepper, Spinner } from './ui';

import { Icon } from '@/components/icons';
export interface MarchDialogProps {
  open: boolean;
  onClose: () => void;
  /** Preselect the province the army leaves from. */
  sourceId?: string | null;
  /** Preselect the destination. */
  targetId?: string | null;
}

export function MarchDialog({ open, onClose, sourceId, targetId }: MarchDialogProps) {
  if (!open) return null;
  return <MarchDialogBody onClose={onClose} sourceId={sourceId ?? null} targetId={targetId ?? null} />;
}

function MarchDialogBody({ onClose, sourceId, targetId }: { onClose: () => void; sourceId: string | null; targetId: string | null }) {
  const { resources } = useGame();
  const army = useApi<ArmyOverviewResponse>('/api/army', EVENTS.army);
  const map = useApi<WorldMapResponse>('/api/world/map', EVENTS.map);
  const action = useAction();

  const [source, setSource] = useState<string | null>(sourceId);
  const [dest, setDest] = useState<string | null>(targetId);
  const [units, setUnits] = useState<UnitCounts>(emptyUnits());
  const [confirming, setConfirming] = useState(false);
  const idemKey = useRef(newIdempotencyKey());
  const autoFilled = useRef<string | null>(null);

  const provinces = useMemo(() => map.data?.provinces ?? [], [map.data]);
  const provinceById = useMemo(() => new Map(provinces.map((p) => [p.id, p])), [provinces]);
  const garrisons = useMemo(() => (army.data?.garrisons ?? []).filter((g) => totalUnits(g.units) > 0), [army.data]);

  // Pick a sensible source: the strongest garrison, preferring one that borders the target.
  useEffect(() => {
    if (source || garrisons.length === 0 || !map.data) return;
    const target = dest ? provinceById.get(dest) : undefined;
    const neighbourCodes = target ? (PROVINCE_BY_CODE[target.code]?.neighbors ?? []) : [];
    const candidates = garrisons.filter((g) => g.provinceId !== dest);
    const ranked = [...candidates].sort((a, b) => {
      const an = Number(neighbourCodes.includes(provinceById.get(a.provinceId)?.code ?? ''));
      const bn = Number(neighbourCodes.includes(provinceById.get(b.provinceId)?.code ?? ''));
      return bn - an || b.power - a.power;
    });
    if (ranked[0]) setSource(ranked[0].provinceId);
  }, [source, dest, garrisons, provinceById, map.data]);

  const available = useMemo<UnitCounts>(() => garrisons.find((g) => g.provinceId === source)?.units ?? emptyUnits(), [garrisons, source]);
  const destProvince = dest ? provinceById.get(dest) : undefined;
  const destIsOwn = destProvince?.relation === 'own';

  // Default force: everything for an attack, nothing for a transfer.
  useEffect(() => {
    if (!source || !army.data) return;
    const key = `${source}>${dest ?? ''}`;
    if (autoFilled.current === key) return;
    autoFilled.current = key;
    setUnits(dest && !destIsOwn ? { ...available } : emptyUnits());
    setConfirming(false);
  }, [source, dest, destIsOwn, available, army.data]);

  // Never exceed what is stationed there (e.g. after a refresh).
  useEffect(() => {
    setUnits((u) => {
      let changed = false;
      const next = { ...u };
      for (const t of UNIT_TYPES) {
        if (next[t] > available[t]) {
          next[t] = available[t];
          changed = true;
        }
      }
      return changed ? next : u;
    });
  }, [available]);

  const total = totalUnits(units);
  const power = armyPower(units);

  // Live preview from the server.
  const request = useMemo(() => (source && dest && total > 0 ? { fromProvinceId: source, toProvinceId: dest, units } : null), [source, dest, units, total]);
  const debounced = useDebounced(request, 280);
  const [preview, setPreview] = useState<MarchPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => {
    setConfirming(false);
    idemKey.current = newIdempotencyKey();
    if (!debounced) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    apiPost<MarchPreviewResponse>('/api/army/preview', debounced)
      .then((res) => {
        if (cancelled) return;
        setPreview(res);
        setPreviewError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(err instanceof ApiError ? err.message : errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setPreviewing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const stale = request !== debounced || previewing;
  const intent = preview?.intent ?? (destIsOwn ? 'move' : 'attack');
  const isAttack = intent === 'attack';
  const lacksFood = preview ? preview.supplies > resources.food : false;

  let blocked: string | null = null;
  if (!source) blocked = 'Choose where the army sets out from';
  else if (!dest) blocked = 'Choose a destination';
  else if (total <= 0) blocked = 'Choose how many soldiers to send';
  else if (previewError) blocked = previewError;
  else if (preview && !preview.ok) blocked = preview.reason ?? 'This order cannot be given';
  else if (lacksFood) blocked = 'Not enough food for the campaign supplies';

  const send = async () => {
    if (!source || !dest) return;
    const result = await action.run(
      () =>
        isAttack
          ? apiPost<MarchResponse>('/api/battles/declare', { fromProvinceId: source, targetProvinceId: dest, units }, { idempotencyKey: idemKey.current })
          : apiPost<MarchResponse>('/api/army/move', { fromProvinceId: source, toProvinceId: dest, units }, { idempotencyKey: idemKey.current }),
      {
        success: () =>
          isAttack ? `Your army marches on ${destProvince?.name ?? 'the enemy'}.` : `Your soldiers set out for ${destProvince?.name ?? 'their new post'}.`,
      },
    );
    if (result) onClose();
    else idemKey.current = newIdempotencyKey();
  };

  const destOptions = provinces.filter((p) => p.id !== source);
  const knownStrength = destProvince && !destIsOwn ? destProvince.strength : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={isAttack && dest ? 'Order an attack' : 'Send an army'}
      kanji={isAttack && dest ? '攻' : '進'}
      wide
      footer={
        confirming ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)} disabled={action.busy}>
              Back
            </button>
            <ActionButton variant="primary" onClick={send} busy={action.busy}>
              Give the order
            </ActionButton>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <ActionButton
              variant={isAttack ? 'primary' : 'gold'}
              reason={blocked}
              busy={action.busy || (!blocked && stale)}
              onClick={() => (isAttack ? setConfirming(true) : void send())}
            >
              {isAttack ? 'Review attack' : 'March'}
            </ActionButton>
          </>
        )
      }
    >
      {army.error || map.error ? (
        <ErrorState
          message={(army.error ?? map.error)!.message}
          onRetry={() => {
            void army.refresh();
            void map.refresh();
          }}
        />
      ) : !army.data || !map.data ? (
        <LoadingState label="Counting spears…" />
      ) : garrisons.length === 0 ? (
        <ErrorState message="You have no soldiers stationed anywhere. Recruit at a Barracks first." />
      ) : confirming ? (
        <div className="space-y-4">
          <div className="paper p-4">
            <p className="font-display text-lg font-bold leading-snug">
              {fmt(total)} soldiers will march from {provinceById.get(source!)?.name} against {destProvince?.name}.
            </p>
            <p className="mt-2 text-sm">
              Once the column has left it cannot be recalled. If the attack fails, the survivors fall back to where they set out from.
              {destProvince?.ownerClanId ? ' Attacking another clan ends any protection you still enjoy.' : ''}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Fact label="Your force" value={`${fmt(power)} power`} />
            <Fact label="Defenders" value={knownStrength ? (knownStrength.power !== null ? `${fmt(knownStrength.power)} power` : knownStrength.label) : 'Unknown'} />
            <Fact label="March" value={preview ? fmtDuration(preview.durationMs) : '—'} />
            <Fact label="Supplies" value={preview ? `${fmt(preview.supplies)} food` : '—'} />
          </dl>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wider text-muted">Set out from</span>
              <select className="field" value={source ?? ''} onChange={(e) => setSource(e.target.value || null)}>
                {garrisons.map((g) => (
                  <option key={g.provinceId} value={g.provinceId}>
                    {g.provinceName} — {fmt(totalUnits(g.units))} soldiers
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wider text-muted">Destination</span>
              <select className="field" value={dest ?? ''} onChange={(e) => setDest(e.target.value || null)}>
                <option value="">Choose a province…</option>
                {destOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.relation === 'own' ? 'yours' : p.relation === 'enemy' ? 'at war' : p.relation === 'unclaimed' ? 'unclaimed' : 'another clan'}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="heading-rule flex-1">Soldiers to send</span>
              <button type="button" className="btn btn-sm" onClick={() => setUnits({ ...available })}>
                All
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setUnits(emptyUnits())}>
                None
              </button>
            </div>
            <ul className="space-y-2.5">
              {UNIT_TYPES.filter((t) => available[t] > 0).map((t) => (
                <li key={t} className="panel-flat p-2.5">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="seal seal-sm seal-ink" aria-hidden>
                      <Icon name={t} />
                    </span>
                    <span className="flex-1 font-display font-bold">{UNITS[t].name}</span>
                    <span className="num text-xs text-muted">
                      {fmt(units[t])} of {fmt(available[t])}
                    </span>
                  </div>
                  <NumberStepper label={UNITS[t].name} value={units[t]} max={available[t]} step={available[t] > 200 ? 50 : 10} onChange={(n) => setUnits((u) => ({ ...u, [t]: n }))} />
                </li>
              ))}
            </ul>
          </div>

          <div className="paper p-3.5">
            <div className="mb-2 flex items-center gap-2">
              <span className="font-display text-base font-bold">{isAttack ? 'Plan of attack' : 'Marching orders'}</span>
              {stale && request ? <Spinner className="!border-ink-600/30 !border-t-ink-800" /> : null}
            </div>
            {!request ? (
              <p className="text-sm">Choose a destination and at least one soldier to see the route.</p>
            ) : previewError ? (
              <p className="text-sm font-medium text-vermilion-deep">{previewError}</p>
            ) : !preview ? (
              <p className="text-sm">Scouts are tracing the route…</p>
            ) : (
              <>
                {!preview.ok && preview.reason ? <p className="mb-2 text-sm font-bold text-vermilion-deep">{preview.reason}</p> : null}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                  <Fact label="Order" value={preview.intent === 'attack' ? 'Attack' : 'Reinforce'} dark />
                  <Fact label="March time" value={preview.durationMs > 0 ? fmtDuration(preview.durationMs) : '—'} dark />
                  <Fact label="Supplies" value={`${fmt(preview.supplies)} food`} warn={lacksFood} dark />
                  <Fact label="Your force" value={`${fmt(total)} · ${fmt(power)} power`} dark />
                </dl>
                {preview.path.length > 0 ? (
                  <p className="mt-2.5 text-sm">
                    <span className="text-ink-600">Route: </span>
                    <span className="font-medium">
                      {[source, ...preview.path].map((id) => provinceById.get(id ?? '')?.name ?? '?').join(' → ')}
                    </span>
                  </p>
                ) : null}
                {isAttack && knownStrength ? (
                  <p className="mt-1 text-sm">
                    <span className="text-ink-600">Defenders: </span>
                    <span className="font-medium">
                      {knownStrength.label}
                      {knownStrength.power !== null ? ` (${fmt(knownStrength.power)} power${knownStrength.exact ? ', scouted' : ', estimate'})` : ''}
                    </span>
                  </p>
                ) : isAttack && dest ? (
                  <p className="mt-1 text-sm text-ink-600">Defenders: unknown. Send a scout first to count their spears.</p>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function Fact({ label, value, warn, dark }: { label: string; value: string; warn?: boolean; dark?: boolean }) {
  return (
    <div>
      <dt className={`text-[0.66rem] uppercase tracking-wider ${dark ? 'text-ink-600' : 'text-muted'}`}>{label}</dt>
      <dd className={`num font-display text-[1.02rem] font-bold leading-tight ${warn ? 'text-vermilion-deep' : ''}`}>{value}</dd>
    </div>
  );
}
