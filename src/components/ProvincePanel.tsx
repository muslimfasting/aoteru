'use client';

/**
 * Province detail: shown as a side panel on desktop and a bottom sheet on
 * phones (the map screen decides the container). Every action offered here is
 * one the server said is possible; blocked actions show the server's reason.
 */
import Link from 'next/link';
import { useState } from 'react';
import type { ClanPublicDTO, EspionageResponse, ProvinceDetailResponse } from '@/game/api';
import { BUILDINGS, BUILDING_EFFECTS, RESOURCE_INFO, RESOURCE_KEYS, TERRAIN_INFO, armyPower, totalUnits } from '@/game/config';
import { PROVINCE_BY_CODE } from '@/game/map';
import { apiPost } from '@/lib/api';
import { EVENTS } from '@/lib/events';
import { cx, fmt, fmtDuration, fmtPct } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { useGame } from '@/lib/game-context';
import { useNow } from '@/lib/clock';
import { MonBadge, NeutralBadge } from './Banner';
import { ActionButton, Bar, ConfirmDialog, Countdown, ErrorState, LoadingState, TimedProgress, UnitsRow } from './ui';

import { Glyph, Icon } from '@/components/icons';
export function relationChip(relation: string): { label: string; cls: string } {
  switch (relation) {
    case 'own':
      return { label: 'Your land', cls: 'chip' };
    case 'enemy':
      return { label: 'At war', cls: 'chip chip-red' };
    case 'unclaimed':
      return { label: 'Unclaimed', cls: 'chip chip-muted' };
    default:
      return { label: 'Another clan', cls: 'chip chip-muted' };
  }
}

export function ProvincePanel({
  provinceId,
  clans,
  onClose,
  onMarch,
}: {
  provinceId: string;
  clans: ClanPublicDTO[];
  onClose?: () => void;
  /** Open the march dialog from (own province) or against (any other) this province. */
  onMarch: (opts: { sourceId?: string; targetId?: string }) => void;
}) {
  const state = useApi<ProvinceDetailResponse>(`/api/provinces/${provinceId}`, EVENTS.province);
  const { resources } = useGame();
  const now = useNow();
  const scout = useAction();
  const [scoutOpen, setScoutOpen] = useState(false);

  if (state.error && !state.data) return <ErrorState message={state.error.message} onRetry={() => void state.refresh()} />;
  if (!state.data) return <LoadingState label="Consulting the province register…" />;

  const { province: p, own, intel, actions, activeEvents } = state.data;
  const def = PROVINCE_BY_CODE[p.code];
  const owner = p.ownerClanId ? clans.find((c) => c.id === p.ownerClanId) : undefined;
  const chip = relationChip(p.relation);
  const terrain = TERRAIN_INFO[p.terrain];
  const protectedUntil = owner?.protectedUntil && Date.parse(owner.protectedUntil) > now ? owner.protectedUntil : null;
  const upgrading = own?.buildings.filter((b) => b.upgrading) ?? [];

  const doScout = async () => {
    const res = await scout.run(() => apiPost<EspionageResponse>('/api/espionage/execute', { operation: 'scout', provinceId: p.id }), {
      success: `A scout slips across the border into ${p.name}.`,
    });
    if (res) setScoutOpen(false);
  };

  return (
    <div className="flex flex-col">
      {/* header */}
      <header className="flex items-start gap-3 border-b border-gold/20 p-4">
        <div className="paper grid h-16 w-16 shrink-0 place-items-center">
          <span className="font-display text-[1.9rem] font-bold leading-none"><Glyph k={def?.kanji ?? p.kanji} /></span>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl font-extrabold leading-tight">{p.name}</h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className={chip.cls}>{chip.label}</span>
            <span className="chip chip-muted">{terrain.name}</span>
            {p.isCapital ? <span className="chip">Capital</span> : null}
            {p.underAttack ? <span className="chip chip-red">Under attack</span> : null}
          </div>
        </div>
        {onClose ? (
          <button type="button" className="btn btn-ghost -mr-2 -mt-1 !min-h-[44px] !min-w-[44px] !px-0 text-lg" onClick={onClose} aria-label="Close province details">
            ✕
          </button>
        ) : null}
      </header>

      <div className="space-y-4 p-4">
        {/* ruler */}
        <div className="flex items-center gap-3">
          {owner ? <MonBadge color={owner.banner.color} mon={owner.banner.mon} size={36} /> : <NeutralBadge size={36} />}
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate font-display font-bold">{owner ? `${owner.name} clan` : 'No clan rules here'}</div>
            <div className="truncate text-xs text-muted">
              {owner ? `${owner.daimyoName}${owner.isNpc ? ' · rival daimyo' : owner.playerNickname ? ` · ${owner.playerNickname}` : ''}` : 'Held by local warriors'}
            </div>
          </div>
        </div>
        {protectedUntil ? (
          <p className="panel-flat px-3 py-2 text-xs text-muted">
            This clan is under the shogunate&apos;s truce for another <Countdown to={protectedUntil} className="font-bold text-gold-bright" done="a moment" /> and cannot be attacked.
          </p>
        ) : null}

        <p className="border-l-2 border-gold/40 pl-3 font-display text-[0.95rem] italic leading-relaxed text-parchment/85">{p.lore || def?.lore}</p>

        {/* facts */}
        <dl className="grid grid-cols-3 gap-2 text-center">
          <Fact label="Population" value={fmt(p.population)} />
          <Fact label="Castle" value={`Lv ${p.castleLevel}`} />
          <Fact label="Defense" value={`+${fmtPct(terrain.defense * (1 + p.castleLevel * BUILDING_EFFECTS.castleDefensePerLevel) - 1)}`} hint="terrain + walls" />
        </dl>

        <section>
          <div className="heading-rule mb-2">{own ? 'Hourly yield' : 'Base yield per hour'}</div>
          <ul className="grid grid-cols-5 gap-1.5">
            {RESOURCE_KEYS.map((k) => (
              <li key={k} className="panel-flat flex flex-col items-center py-1.5" title={RESOURCE_INFO[k].name}>
                <span className="font-display text-sm font-bold text-gold" aria-hidden>
                  <Icon name={k} />
                </span>
                <span className="sr-only">{RESOURCE_INFO[k].name}</span>
                <span className="num text-sm font-bold">{fmt(own ? own.production[k] : p.base[k])}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-muted">{terrain.note}</p>
        </section>

        {own ? (
          <>
            <section>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="text-muted">Loyalty</span>
                <span className={cx('num font-bold', own.loyalty < 30 ? 'text-vermilion-bright' : own.loyalty >= 70 ? 'text-jade' : '')}>{Math.round(own.loyalty)} / 100</span>
              </div>
              <Bar value={own.loyalty} max={100} tone={own.loyalty < 30 ? 'red' : own.loyalty >= 70 ? 'jade' : 'gold'} label="Loyalty" />
              {own.loyalty < 30 ? <p className="mt-1 text-xs text-vermilion-bright">Unrest is growing. Low loyalty cuts production and risks rebellion.</p> : null}
            </section>

            <section>
              <div className="heading-rule mb-2">Garrison</div>
              <UnitsRow units={own.garrison} />
              <p className="mt-1 text-xs text-muted">
                {fmt(totalUnits(own.garrison))} soldiers · {fmt(armyPower(own.garrison))} power
              </p>
            </section>

            {upgrading.length > 0 || own.recruitment.length > 0 ? (
              <section className="space-y-2.5">
                <div className="heading-rule">In progress</div>
                {upgrading.map((b) => (
                  <TimedProgress key={b.type} from={b.upgrading!.startedAt} to={b.upgrading!.completesAt} label={`${BUILDINGS[b.type].name} → level ${b.upgrading!.toLevel}`} onDone={() => void state.refresh()} />
                ))}
                {own.recruitment.map((r) => (
                  <TimedProgress key={r.id} from={r.startedAt} to={r.completesAt} label={`Mustering ${fmt(r.count)} ${r.unitType}`} onDone={() => void state.refresh()} />
                ))}
              </section>
            ) : null}

            <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-3">
              <Link href={`/game/castle?province=${p.id}`} className="btn btn-gold">
                Manage
              </Link>
              <Link href={`/game/military?province=${p.id}`} className="btn">
                Recruit
              </Link>
              <ActionButton onClick={() => onMarch({ sourceId: p.id })} reason={totalUnits(own.garrison) === 0 ? 'No soldiers here' : null}>
                Send army
              </ActionButton>
            </div>
          </>
        ) : (
          <>
            <section>
              <div className="heading-rule mb-2">Defenders</div>
              {intel ? (
                <div className="paper p-3">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-display font-bold">Scout&apos;s report</span>
                    <span className="text-xs">
                      valid for <Countdown to={intel.expiresAt} className="font-bold" done="expired" onDone={() => void state.refresh()} />
                    </span>
                  </div>
                  <UnitsRow units={intel.units} />
                  <p className="num mt-1.5 text-sm">
                    {fmt(totalUnits(intel.units))} soldiers · {fmt(intel.power)} power · castle level {intel.castleLevel} · loyalty {Math.round(intel.loyalty)}
                  </p>
                </div>
              ) : p.strength ? (
                <p className="text-sm">
                  <span className="font-display text-base font-bold">{p.strength.label}</span>
                  <span className="text-muted"> — {p.strength.exact ? 'counted by your scouts' : 'a rough estimate from across the border'}</span>
                </p>
              ) : (
                <p className="text-sm text-muted">Nothing is known of the defenders. Only provinces that border your land can be judged by eye; send a scout for a true count.</p>
              )}
            </section>

            <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
              <ActionButton variant="primary" reason={actions.attackBlockedReason} onClick={() => onMarch({ targetId: p.id })}>
                Attack
              </ActionButton>
              <ActionButton reason={actions.scoutBlockedReason} onClick={() => setScoutOpen(true)}>
                Scout · {fmt(actions.scoutCost)} gold
              </ActionButton>
            </div>
            {owner && p.relation === 'foreign' ? (
              <p className="text-xs text-muted">
                You are at peace with the {owner.name}.{' '}
                <Link href="/game/diplomacy" className="tap-link text-gold">
                  Open diplomacy
                </Link>{' '}
                to declare war before you can march on their land.
              </p>
            ) : null}
          </>
        )}

        {activeEvents.length > 0 ? (
          <section>
            <div className="heading-rule mb-2">Events in force</div>
            <ul className="space-y-2">
              {activeEvents.map((e) => (
                <li key={e.id} className="panel-flat p-3">
                  <div className="font-display font-bold">{e.title}</div>
                  <p className="text-sm text-muted">{e.description}</p>
                  {e.endsAt ? (
                    <p className="mt-1 text-xs text-gold">
                      ends in <Countdown to={e.endsAt} done="moments" />
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <ConfirmDialog
        open={scoutOpen}
        onClose={() => setScoutOpen(false)}
        onConfirm={doScout}
        busy={scout.busy}
        title={`Scout ${p.name}`}
        kanji="忍"
        confirmLabel={`Send scout · ${fmt(actions.scoutCost)} gold`}
      >
        <p>
          A scout will cross into {p.name} and count its defenders, walls and stores. The report stays useful for a limited time.
        </p>
        <dl className="grid grid-cols-3 gap-2 text-center">
          <Fact label="Cost" value={`${fmt(actions.scoutCost)}`} hint="gold" warn={resources.gold < actions.scoutCost} />
          <Fact label="Success" value={fmtPct(actions.scoutChance)} />
          <Fact label="Returns in" value={fmtDuration(actions.scoutDurationMs)} />
        </dl>
        <p className="text-xs text-muted">If the scout is caught, the province&apos;s ruler learns that you were watching.</p>
      </ConfirmDialog>
    </div>
  );
}

function Fact({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div className="panel-flat px-2 py-2">
      <dt className="text-[0.62rem] uppercase tracking-wider text-muted">{label}</dt>
      <dd className={cx('num font-display text-lg font-bold leading-tight', warn && 'text-vermilion-bright')}>{value}</dd>
      {hint ? <div className="text-[0.62rem] text-muted">{hint}</div> : null}
    </div>
  );
}
