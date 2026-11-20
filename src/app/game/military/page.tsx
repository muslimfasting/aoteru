'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import type { ArmyOverviewResponse, BattleListResponse, BattleSummaryDTO, MovementDTO, ProvinceDetailResponse, RecruitOptionDTO, WorldMapResponse } from '@/game/api';
import { RESOURCE_INFO, UNITS, UNIT_TYPES, armyPower, unitCost, type UnitType } from '@/game/config';
import { MarchDialog } from '@/components/MarchDialog';
import { ActionButton, Bar, CostRow, Countdown, EmptyState, ErrorState, LoadingState, NumberStepper, PageHeader, Panel, Stat, Tabs, TimedProgress, UnitsRow } from '@/components/ui';
import { apiPost } from '@/lib/api';
import { useNow } from '@/lib/clock';
import { EVENTS } from '@/lib/events';
import { cx, fmt, fmtDuration, missingResources, timeAgo } from '@/lib/format';
import { useGame } from '@/lib/game-context';
import { useAction, useApi, useIsDesktop, type ApiState } from '@/lib/hooks';
import { RESULT_STYLE, viewerResult } from '@/lib/world';

import { Glyph, Icon } from '@/components/icons';
type Tab = 'recruit' | 'armies' | 'battles';

export default function MilitaryPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <MilitaryScreen />
    </Suspense>
  );
}

function MilitaryScreen() {
  const params = useSearchParams();
  const army = useApi<ArmyOverviewResponse>('/api/army', EVENTS.army);
  const battles = useApi<BattleListResponse>('/api/battles', EVENTS.battles);
  const map = useApi<WorldMapResponse>('/api/world/map', EVENTS.map);
  const isDesktop = useIsDesktop();
  const [tab, setTab] = useState<Tab>(params.get('province') ? 'recruit' : 'armies');
  const [march, setMarch] = useState<{ sourceId?: string; targetId?: string } | null>(null);

  if (army.error && !army.data) return <ErrorState message={army.error.message} onRetry={() => void army.refresh()} />;
  if (!army.data) return <LoadingState label="Calling the muster roll…" />;
  const a = army.data;
  const pendingBattles = battles.data?.battles.filter((b) => b.status === 'pending').length ?? 0;

  const recruit = <RecruitPanel garrisons={a.garrisons} initialProvinceId={params.get('province')} />;
  const armies = (
    <div className="space-y-4 lg:space-y-5">
      <Garrisons army={a} onSend={(id) => setMarch({ sourceId: id })} />
      <Movements movements={a.movements} provinceName={(id) => map.data?.provinces.find((p) => p.id === id)?.name ?? a.garrisons.find((g) => g.provinceId === id)?.provinceName ?? '…'} onRefresh={() => void army.refresh()} />
      <RecruitmentQueue army={a} onRefresh={() => void army.refresh()} />
    </div>
  );
  const history = <BattleHistory state={battles} />;

  return (
    <div>
      <PageHeader
        kanji="軍"
        title="Military"
        subtitle="Muster soldiers, move armies and read the reports from the field."
        action={
          <div className="hidden sm:block">
            <ActionButton variant="primary" onClick={() => setMarch({})} reason={a.total === 0 ? 'No soldiers to command' : null}>
              Send an army
            </ActionButton>
          </div>
        }
      />

      <div className="panel mb-4 grid grid-cols-2 gap-x-4 gap-y-3 p-4 sm:grid-cols-4 lg:mb-5">
        <div>
          <Stat label="Under arms" value={`${fmt(a.total)} / ${fmt(a.capacity)}`} />
          <Bar className="mt-1.5" value={a.total + a.recruiting} max={a.capacity} tone={a.total + a.recruiting >= a.capacity ? 'red' : 'gold'} label="Army capacity used" />
        </div>
        <Stat label="Power" value={fmt(a.power)} hint="combined strength" />
        <Stat label="Mustering" value={fmt(a.recruiting)} hint="in training" />
        <Stat label="Upkeep / hour" value={`${fmt(a.upkeep.food)} food`} hint={`and ${fmt(a.upkeep.gold)} gold`} />
      </div>

      <div className="mb-4 sm:hidden">
        <ActionButton variant="primary" onClick={() => setMarch({})} reason={a.total === 0 ? 'No soldiers to command' : null} wrapperClassName="flex w-full" className="w-full">
          Send an army
        </ActionButton>
      </div>

      {isDesktop ? (
        <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-5">
          <div className="space-y-5">
            {recruit}
            {history}
          </div>
          {armies}
        </div>
      ) : (
        <>
          <Tabs<Tab>
            className="mb-4"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'armies', label: 'Armies', badge: a.movements.length || null },
              { id: 'recruit', label: 'Recruit', badge: a.recruitment.length || null },
              { id: 'battles', label: 'Battles', badge: pendingBattles || null },
            ]}
          />
          {tab === 'recruit' ? recruit : tab === 'armies' ? armies : history}
        </>
      )}

      <MarchDialog open={march !== null} onClose={() => setMarch(null)} sourceId={march?.sourceId} targetId={march?.targetId} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Garrisons({ army, onSend }: { army: ArmyOverviewResponse; onSend: (provinceId: string) => void }) {
  return (
    <Panel title="Garrisons" kanji="守" bodyClassName="p-0">
      {army.garrisons.length === 0 ? (
        <EmptyState title="No garrisons">You hold no province to station soldiers in.</EmptyState>
      ) : (
        <ul className="divide-y divide-gold/10">
          {army.garrisons.map((g) => (
            <li key={g.provinceId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <div className="min-w-[8rem] flex-1">
                <div className="font-display text-base font-bold">{g.provinceName}</div>
                <UnitsRow units={g.units} className="mt-1" />
              </div>
              <div className="num text-right text-sm text-muted">{fmt(g.power)} power</div>
              <ActionButton size="sm" onClick={() => onSend(g.provinceId)} reason={g.power === 0 ? 'Empty' : null}>
                Send
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Movements({ movements, provinceName, onRefresh }: { movements: MovementDTO[]; provinceName: (id: string) => string; onRefresh: () => void }) {
  return (
    <Panel title="On the march" kanji="進">
      {movements.length === 0 ? (
        <p className="text-sm text-muted">No army is on the road. Send one from a garrison to reinforce a province or attack a neighbour.</p>
      ) : (
        <ul className="space-y-3">
          {movements.map((m) => (
            <li key={m.id} className="panel-flat p-3">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className={m.intent === 'attack' ? 'chip chip-red' : 'chip chip-muted'}>{m.intent === 'attack' ? 'Attack' : m.intent === 'return' ? 'Returning' : 'Reinforce'}</span>
                <span className="font-display font-bold">
                  {provinceName(m.fromProvinceId)} → {provinceName(m.toProvinceId)}
                </span>
              </div>
              {m.units ? <UnitsRow units={m.units} className="mb-2" /> : null}
              {m.status === 'besieging' ? (
                <p className="text-sm">
                  <span className="font-bold text-vermilion-bright">Fighting at the walls.</span>{' '}
                  {m.battleId ? (
                    <Link href={`/game/battles/${m.battleId}`} className="tap-link text-gold">
                      Watch the battle
                    </Link>
                  ) : null}
                </p>
              ) : (
                <TimedProgress from={m.departedAt} to={m.arrivesAt} label={m.intent === 'attack' ? 'Marching to battle' : 'On the road'} onDone={onRefresh} />
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RecruitmentQueue({ army, onRefresh }: { army: ArmyOverviewResponse; onRefresh: () => void }) {
  if (army.recruitment.length === 0) return null;
  return (
    <Panel title="In training" kanji="練">
      <ul className="space-y-3">
        {army.recruitment.map((r) => (
          <li key={r.id}>
            <TimedProgress from={r.startedAt} to={r.completesAt} label={`${fmt(r.count)} ${UNITS[r.unitType].name} · ${r.provinceName}`} onDone={onRefresh} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function RecruitPanel({ garrisons, initialProvinceId }: { garrisons: ArmyOverviewResponse['garrisons']; initialProvinceId: string | null }) {
  const [provinceId, setProvinceId] = useState<string | null>(garrisons.find((g) => g.provinceId === initialProvinceId)?.provinceId ?? garrisons[0]?.provinceId ?? null);
  useEffect(() => {
    if (!provinceId && garrisons[0]) setProvinceId(garrisons[0].provinceId);
  }, [provinceId, garrisons]);
  const state = useApi<ProvinceDetailResponse>(provinceId ? `/api/provinces/${provinceId}` : null, EVENTS.province);
  const { resources } = useGame();
  const action = useAction();
  const [unit, setUnit] = useState<UnitType>('ashigaru');
  const [count, setCount] = useState(0);

  const own = state.data?.own ?? null;
  const options = useMemo(() => new Map<UnitType, RecruitOptionDTO>((own?.recruitOptions ?? []).map((o) => [o.unitType, o])), [own]);
  const option = options.get(unit);
  const max = option?.max ?? 0;
  useEffect(() => {
    setCount((c) => Math.min(c, max));
  }, [max]);

  const cost = unitCost(unit, count);
  const missing = missingResources(resources, cost);
  const reason =
    option?.blockedReason ??
    (max <= 0 ? 'Not enough resources, people or army capacity' : null) ??
    (count <= 0 ? 'Choose how many to recruit' : null) ??
    (missing.length ? `Not enough ${missing.map((k) => RESOURCE_INFO[k].name.toLowerCase()).join(', ')}` : null);

  const recruit = () =>
    action.run(
      async () => {
        const res = await apiPost<ProvinceDetailResponse>('/api/army/recruit', { provinceId, unitType: unit, count });
        state.setData(res);
        setCount(0);
        return res;
      },
      { success: `${fmt(count)} ${UNITS[unit].name} begin training in ${state.data?.province.name ?? 'the province'}.` },
    );

  return (
    <Panel title="Recruit soldiers" kanji="募">
      {garrisons.length === 0 ? (
        <EmptyState title="No province to recruit in" />
      ) : (
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-muted">Muster in</span>
            <select className="field" value={provinceId ?? ''} onChange={(e) => setProvinceId(e.target.value)}>
              {garrisons.map((g) => (
                <option key={g.provinceId} value={g.provinceId}>
                  {g.provinceName}
                </option>
              ))}
            </select>
          </label>

          {state.error && !state.data ? (
            <ErrorState message={state.error.message} onRetry={() => void state.refresh()} />
          ) : !state.data ? (
            <LoadingState />
          ) : !own ? (
            <EmptyState title="This province is no longer yours" />
          ) : (
            <>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Unit type">
                {UNIT_TYPES.map((t) => {
                  const def = UNITS[t];
                  const opt = options.get(t);
                  const locked = Boolean(opt?.blockedReason);
                  const active = unit === t;
                  return (
                    <li key={t}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => {
                          setUnit(t);
                          setCount(0);
                        }}
                        className={cx(
                          'flex h-full w-full flex-col rounded-[3px] border p-3 text-left transition-colors',
                          active ? 'border-gold bg-gold/12' : 'border-gold/15 bg-ink-800/60 hover:border-gold/45',
                          locked && 'opacity-70',
                        )}
                      >
                        <span className="flex items-center gap-2.5">
                          <span className={cx('seal', !active && 'seal-ink')} aria-hidden>
                            <Icon name={def.type} />
                          </span>
                          <span className="min-w-0 flex-1 leading-tight">
                            <span className="block font-display text-base font-bold">{def.name}</span>
                            <span className="block text-[0.68rem] uppercase tracking-wider text-muted">{def.role}</span>
                          </span>
                        </span>
                        <span className="num mt-2 grid grid-cols-4 gap-1 text-center text-xs">
                          <StatCell label="ATK" value={def.attack} />
                          <StatCell label="DEF" value={def.defense} />
                          <StatCell label="HP" value={def.hp} />
                          <StatCell label="SPD" value={def.speed} />
                        </span>
                        <span className="mt-2 block">
                          <CostRow cost={def.cost} />
                        </span>
                        <span className="mt-1 block text-[0.72rem] text-muted">
                          {locked ? <span className="text-vermilion-bright">{opt?.blockedReason}</span> : opt ? `${fmtDuration(opt.durationMsEach)} each · up to ${fmt(opt.max)}` : ''}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <div className="panel-flat space-y-3 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display font-bold">
                    {UNITS[unit].name} <span className="font-body text-xs font-normal text-muted">× {fmt(count)}</span>
                  </span>
                  <button type="button" className="btn btn-sm" onClick={() => setCount(max)} disabled={max <= 0}>
                    Max {fmt(max)}
                  </button>
                </div>
                <NumberStepper label={UNITS[unit].name} value={count} max={max} step={max > 200 ? 50 : 10} onChange={setCount} />
                <UnitNotes unit={unit} />
                <div className="flex flex-wrap items-end justify-between gap-3 border-t border-gold/15 pt-3">
                  <div className="space-y-1">
                    <CostRow cost={cost} have={resources} />
                    <p className="num text-xs text-muted">
                      {count > 0 && option ? `Ready in ${fmtDuration(option.durationMsEach * count)} · ` : ''}
                      {fmt(armyPower({ [unit]: count }))} power
                    </p>
                  </div>
                  <ActionButton variant="gold" reason={reason} busy={action.busy} onClick={() => void recruit()} wrapperClassName="max-w-[13rem]">
                    Recruit
                  </ActionButton>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-sm bg-ink-950/50 py-1">
      <span className="block text-[0.58rem] tracking-wider text-muted">{label}</span>
      <span className="block font-bold">{value}</span>
    </span>
  );
}

function UnitNotes({ unit }: { unit: UnitType }) {
  const def = UNITS[unit];
  const strong = (Object.entries(def.bonusVs) as [UnitType, number][]).map(([t, v]) => `${UNITS[t].name} ×${v}`);
  return (
    <p className="text-xs leading-relaxed text-muted">
      Eats {def.upkeep.food} food and costs {def.upkeep.gold} gold per hour each.
      {strong.length ? ` Strong against ${strong.join(', ')}.` : ''}
      {def.class === 'ranged' ? ' Looses a volley in the opening round.' : ''}
      {def.class === 'cavalry' ? ' Charges on open ground; weak in hills and mountains.' : ''}
    </p>
  );
}

// ---------------------------------------------------------------------------

function BattleHistory({ state }: { state: ApiState<BattleListResponse> }) {
  const now = useNow();
  return (
    <Panel title="Battle reports" kanji="報" bodyClassName="p-0">
      {state.error && !state.data ? (
        <ErrorState message={state.error.message} onRetry={() => void state.refresh()} />
      ) : !state.data ? (
        <LoadingState />
      ) : state.data.battles.length === 0 ? (
        <EmptyState kanji="和" title="No battles yet">
          Your blades are still clean. Reports from every battle you fight will be kept here.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-gold/10">
          {state.data.battles.map((b) => (
            <BattleRow key={b.id} b={b} now={now} onDone={() => void state.refresh()} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function BattleRow({ b, now, onDone }: { b: BattleSummaryDTO; now: number; onDone: () => void }) {
  const result = viewerResult(b);
  const style = RESULT_STYLE[result];
  const opponent = b.role === 'attacker' ? b.defenderName : b.attackerName;
  return (
    <li>
      <Link href={`/game/battles/${b.id}`} className="flex min-h-[60px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-parchment/5">
        <span className={cx('seal', result === 'won' && 'seal-gold', (result === 'draw' || result === 'cancelled') && 'seal-ink')} aria-hidden>
          <Glyph k={style.kanji} />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate font-display text-base font-bold">
            {b.role === 'attacker' ? 'Attack on' : 'Defense of'} {b.provinceName}
          </span>
          <span className="block truncate text-xs text-muted">
            against {opponent}
            {b.provinceCaptured ? (b.role === 'attacker' ? ' · province taken' : ' · province lost') : ''}
            {b.attackerLosses !== null && b.defenderLosses !== null ? ` · losses ${fmt(b.role === 'attacker' ? b.attackerLosses : b.defenderLosses)} / ${fmt(b.role === 'attacker' ? b.defenderLosses : b.attackerLosses)}` : ''}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <span className={style.chip}>{style.label}</span>
          <span className="num text-[0.7rem] text-muted">
            {b.status === 'pending' ? <Countdown to={b.resolvesAt} done="resolving…" onDone={onDone} /> : now ? timeAgo(b.resolvedAt ?? b.startedAt, now) : ''}
          </span>
        </span>
      </Link>
    </li>
  );
}
