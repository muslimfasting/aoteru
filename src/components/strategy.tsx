'use client';

/**
 * Shared pieces for the Art of War: choosing a tactic, showing a stance, and
 * saying plainly what defeats what. All names and descriptions come from
 * `src/game/strategy.ts`, so the screens can never drift from the rules.
 */
import Link from 'next/link';
import { useState } from 'react';
import type { TacticOptionDTO } from '@/game/api';
import type { ResourceBag } from '@/game/config';
import { PILLAR_DEFS } from '@/game/pillars';
import { STANCE_DEFS, TACTICS, TACTIC_DEFS, type StanceId, type TacticId } from '@/game/strategy';
import { Icon, type IconName } from '@/components/icons';
import { useNow } from '@/lib/clock';
import { cx, fmtDuration, timeAgo } from '@/lib/format';
import { useIsDesktop } from '@/lib/hooks';
import { CostRow, Dialog } from './ui';

export const TACTIC_ICON: Record<TacticId, IconName> = {
  assault: 'military',
  flanking: 'cavalry',
  night_raid: 'moon',
  feigned_retreat: 'leave',
  siege: 'castle',
  pincer: 'tactic',
};

export const STANCE_ICON: Record<StanceId, IconName> = {
  formation: 'shield',
  night_watch: 'intel',
  hold: 'castle',
  ambush: 'alert',
  reserve: 'people',
  stockpile: 'food',
};

export const isTactic = (value: string | null | undefined): value is TacticId => !!value && (TACTICS as readonly string[]).includes(value);

export function tacticName(id: string | null | undefined): string {
  return isTactic(id) ? TACTIC_DEFS[id].name : TACTIC_DEFS.assault.name;
}

/** "81%" for a rolled tactic, "certain" for one that cannot fail. */
export function chanceLabel(chance: number | null): string {
  return chance === null ? 'certain' : `${Math.round(chance * 100)}%`;
}

/** The tactic a stance defeats, as a sentence. */
export function stanceDefeats(stance: StanceId): string {
  const def = STANCE_DEFS[stance];
  if (def.counters) return `Defeats ${TACTIC_DEFS[def.counters].name}.`;
  if (stance === 'ambush') return 'No tactic answers it; only scouts who find it first.';
  return 'Defeats no particular tactic.';
}

/** The stance that defeats a tactic, as a sentence. */
export function tacticDefeatedBy(tactic: TacticId): string {
  const def = TACTIC_DEFS[tactic];
  return def.counter ? `Defeated by ${STANCE_DEFS[def.counter].name}.` : 'Nothing defeats it, and it gains nothing.';
}

export function TacticSeal({ tactic, size = 'sm', tone = 'ink' }: { tactic: TacticId; size?: 'sm' | 'lg'; tone?: 'ink' | 'red' | 'gold' }) {
  return (
    <span className={cx('seal shrink-0', size === 'sm' ? 'seal-sm' : 'seal-lg', tone === 'ink' && 'seal-ink', tone === 'gold' && 'seal-gold')} aria-hidden>
      <Icon name={TACTIC_ICON[tactic]} />
    </span>
  );
}

export function StanceSeal({ stance, size = 'sm' }: { stance: StanceId; size?: 'sm' | 'lg' }) {
  return (
    <span className={cx('seal seal-ink shrink-0', size === 'sm' ? 'seal-sm' : 'seal-lg')} aria-hidden>
      <Icon name={STANCE_ICON[stance]} />
    </span>
  );
}

export interface KnownStance {
  stance: StanceId;
  stanceName: string;
  reportedAt?: string;
}

/**
 * What the scouts say about how the target is held — and what it means for
 * the chosen tactic. Without a report it says so, and where to get one.
 */
export function KnownStanceNote({ known, tactic, paper, className }: { known: KnownStance | null; tactic?: TacticId; paper?: boolean; className?: string }) {
  const now = useNow();
  const warn = paper ? 'text-vermilion-deep' : 'text-vermilion-bright';
  const good = paper ? 'text-[#2f6b4f]' : 'text-jade';
  const soft = paper ? 'text-ink-600' : 'text-muted';
  if (!known) {
    return (
      <p className={cx('flex items-start gap-2 text-sm', soft, className)}>
        <Icon name="intel" className="mt-0.5 shrink-0" />
        <span>
          The enemy&apos;s stance is unknown. A scouting report would reveal it, and show which tactic it is ready for.{' '}
          <Link href="/game/intel" className={cx('font-bold underline underline-offset-2', paper ? 'text-ink-800' : 'text-gold-bright')}>
            Send scouts
          </Link>
        </span>
      </p>
    );
  }
  const def = STANCE_DEFS[known.stance];
  const counters = !!tactic && TACTIC_DEFS[tactic].counter === known.stance;
  const ambush = known.stance === 'ambush';
  return (
    <div className={cx('flex items-start gap-2 text-sm', className)}>
      <Icon name={STANCE_ICON[known.stance]} className={cx('mt-0.5 shrink-0', soft)} />
      <div>
        <p>
          <span className={soft}>Scouts report the garrison holds </span>
          <strong>{def.name}</strong>
          {known.reportedAt ? <span className={soft}> ({timeAgo(known.reportedAt, now)})</span> : null}
          <span className={soft}>. {stanceDefeats(known.stance)}</span>
        </p>
        {tactic ? (
          counters ? (
            <p className={cx('mt-0.5 font-bold', warn)}>It is ready for {TACTIC_DEFS[tactic].name}: choose another tactic.</p>
          ) : ambush ? (
            <p className={cx('mt-0.5 font-bold', good)}>Because you found the ambush, it will fail: the garrison is caught outside its walls.</p>
          ) : (
            <p className={cx('mt-0.5 font-bold', good)}>It is not ready for {TACTIC_DEFS[tactic].name}.</p>
          )
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tactic cards and picker
// ---------------------------------------------------------------------------

interface CardProps {
  option: TacticOptionDTO;
  selected: boolean;
  onSelect?: () => void;
  have?: ResourceBag | null;
}

export function TacticCard({ option, selected, onSelect, have }: CardProps) {
  const def = TACTIC_DEFS[option.id];
  const blocked = option.blockedReason;
  const hasCost = Object.values(option.cost).some((v) => (v ?? 0) > 0);
  const body = (
    <>
      <div className="flex w-full items-start gap-2.5">
        <TacticSeal tactic={option.id} tone={selected ? 'gold' : 'ink'} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-display text-base font-bold">{def.name}</span>
            {selected ? <span className="chip chip-jade">Chosen</span> : null}
            {blocked ? (
              <span className="chip chip-muted">
                <Icon name="lock" size="0.9em" /> Not available
              </span>
            ) : null}
          </div>
          <p className="text-xs italic text-muted">{def.maxim}</p>
        </div>
        <span className="num shrink-0 text-right text-xs leading-tight text-muted">
          <span className={cx('block font-display text-base font-bold', option.chance === null ? 'text-parchment' : 'text-gold-bright')}>{chanceLabel(option.chance)}</span>
          {option.chance === null ? 'no roll' : 'comes off'}
        </span>
      </div>
      <p className="mt-2 text-sm text-parchment/90">{def.summary}</p>
      <dl className="mt-2 space-y-1 text-[0.82rem] leading-snug">
        <div className="flex gap-2">
          <dt className="w-[5.2rem] shrink-0 text-jade">If it works</dt>
          <dd className="text-parchment/85">{def.effect}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-[5.2rem] shrink-0 text-vermilion-bright">The risk</dt>
          <dd className="text-parchment/85">{def.risk}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-[5.2rem] shrink-0 text-muted">Counter</dt>
          <dd className="font-bold text-parchment">{tacticDefeatedBy(option.id)}</dd>
        </div>
        {def.requires ? (
          <div className="flex gap-2">
            <dt className="w-[5.2rem] shrink-0 text-muted">Needs</dt>
            <dd className="text-parchment/85">
              {PILLAR_DEFS[def.requires.pillar].name} level {def.requires.level}
            </dd>
          </div>
        ) : null}
        {hasCost || option.extraMs > 0 || option.supplyFactor !== 1 ? (
          <div className="flex gap-2">
            <dt className="w-[5.2rem] shrink-0 text-muted">Costs</dt>
            <dd className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-parchment/85">
              {hasCost ? <CostRow cost={option.cost} have={have} /> : null}
              {option.extraMs > 0 ? <span className="num">+{fmtDuration(option.extraMs)} before the battle is decided</span> : null}
              {option.supplyFactor !== 1 ? <span className="num">×{option.supplyFactor} supplies</span> : null}
            </dd>
          </div>
        ) : null}
      </dl>
      {blocked ? <p className="mt-2 text-[0.82rem] font-bold text-vermilion-bright">{blocked}</p> : null}
      {!blocked && option.counteredByKnownStance ? (
        <p className="mt-2 text-[0.82rem] font-bold text-vermilion-bright">Your scouts say the garrison is ready for exactly this.</p>
      ) : null}
    </>
  );
  const className = cx(
    'panel-flat flex w-full flex-col justify-start p-3 text-left transition-colors',
    selected ? '!border-gold/70 bg-gold/10' : onSelect && !blocked ? 'hover:border-gold/40' : '',
    blocked && 'opacity-70',
  );
  if (!onSelect) return <div className={className}>{body}</div>;
  return (
    <button type="button" className={className} onClick={onSelect} disabled={!!blocked} aria-pressed={selected}>
      {body}
    </button>
  );
}

/**
 * Choose a tactic. `grid` lays the cards out in place; `sheet` shows the
 * chosen one with a button that opens the rest in a dialog (a bottom sheet on
 * phones); `auto` picks by screen width.
 */
export function TacticPicker({
  options,
  value,
  onChange,
  have,
  mode = 'auto',
}: {
  options: TacticOptionDTO[];
  value: TacticId;
  onChange: (tactic: TacticId) => void;
  have?: ResourceBag | null;
  mode?: 'auto' | 'grid' | 'sheet';
}) {
  const desktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value) ?? options[0];
  if (!current) return null;
  const grid = mode === 'grid' || (mode === 'auto' && desktop);
  if (grid) {
    return (
      <div className="grid gap-2.5 md:grid-cols-2">
        {options.map((o) => (
          <TacticCard key={o.id} option={o} selected={o.id === value} onSelect={() => onChange(o.id)} have={have} />
        ))}
      </div>
    );
  }
  const def = TACTIC_DEFS[current.id];
  return (
    <>
      <div className="panel-flat flex items-center gap-3 p-3">
        <TacticSeal tactic={current.id} tone="gold" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="font-display text-base font-bold">{def.name}</div>
          <div className="text-xs text-muted">
            {current.chance === null ? 'Cannot fail' : `Comes off ${chanceLabel(current.chance)}`} · {tacticDefeatedBy(current.id)}
          </div>
          {current.blockedReason ? <div className="mt-0.5 text-xs font-bold text-vermilion-bright">{current.blockedReason}</div> : null}
        </div>
        <button type="button" className="btn btn-sm shrink-0" onClick={() => setOpen(true)}>
          Change
        </button>
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title="Choose a tactic" icon="tactic" wide>
        <div className="space-y-2.5">
          {options.map((o) => (
            <TacticCard
              key={o.id}
              option={o}
              selected={o.id === value}
              have={have}
              onSelect={() => {
                onChange(o.id);
                setOpen(false);
              }}
            />
          ))}
        </div>
      </Dialog>
    </>
  );
}

/** A one-line reminder of how tactics and stances answer each other. */
export function CounterLegend({ className }: { className?: string }) {
  return (
    <ul className={cx('space-y-1.5 text-[0.82rem] leading-snug', className)}>
      {TACTICS.filter((t) => TACTIC_DEFS[t].counter).map((t) => (
        <li key={t} className="flex items-start gap-2">
          <Icon name={TACTIC_ICON[t]} className="mt-0.5 shrink-0 text-gold" />
          <span>
            <strong>{TACTIC_DEFS[t].name}</strong> <span className="text-muted">is stopped by</span> <strong>{STANCE_DEFS[TACTIC_DEFS[t].counter!].name}</strong>
          </span>
        </li>
      ))}
      <li className="flex items-start gap-2">
        <Icon name={STANCE_ICON.ambush} className="mt-0.5 shrink-0 text-gold" />
        <span>
          <strong>{STANCE_DEFS.ambush.name}</strong> <span className="text-muted">is spoiled by</span> <strong>a scouting report</strong>
        </span>
      </li>
    </ul>
  );
}

/**
 * A compact list for places that are already inside a dialog: one row per
 * tactic, with the chosen one opened up to show what it does and risks.
 */
export function TacticList({ options, value, onChange, have }: { options: TacticOptionDTO[]; value: TacticId; onChange: (tactic: TacticId) => void; have?: ResourceBag | null }) {
  return (
    <ul className="space-y-1.5" role="radiogroup" aria-label="Tactic">
      {options.map((o) => {
        const def = TACTIC_DEFS[o.id];
        const selected = o.id === value;
        const hasCost = Object.values(o.cost).some((v) => (v ?? 0) > 0);
        return (
          <li key={o.id}>
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!!o.blockedReason}
              onClick={() => onChange(o.id)}
              className={cx(
                'panel-flat block w-full px-3 py-2 text-left transition-colors',
                selected ? '!border-gold/70 bg-gold/10' : !o.blockedReason ? 'hover:border-gold/40' : '',
                o.blockedReason && 'opacity-70',
              )}
            >
              <span className="flex items-center gap-2.5">
                <span className={cx('grid h-4 w-4 shrink-0 place-items-center rounded-full border', selected ? 'border-gold-bright' : 'border-gold/40')} aria-hidden>
                  {selected ? <span className="h-2 w-2 rounded-full bg-gold-bright" /> : null}
                </span>
                <Icon name={TACTIC_ICON[o.id]} className={selected ? 'text-gold-bright' : 'text-muted'} />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block font-display font-bold">{def.name}</span>
                  <span className="block text-xs text-muted">{o.blockedReason ?? tacticDefeatedBy(o.id)}</span>
                </span>
                <span className={cx('num shrink-0 text-sm font-bold', o.chance === null ? 'text-muted' : 'text-gold-bright')}>{chanceLabel(o.chance)}</span>
              </span>
              {selected && o.id !== 'assault' ? (
                <span className="mt-2 block space-y-1 border-t border-gold/15 pt-2 text-[0.82rem] leading-snug">
                  <span className="block">
                    <span className="text-jade">If it works: </span>
                    <span className="text-parchment/85">{def.effect}</span>
                  </span>
                  <span className="block">
                    <span className="text-vermilion-bright">The risk: </span>
                    <span className="text-parchment/85">{def.risk}</span>
                  </span>
                  {hasCost || o.extraMs > 0 || o.supplyFactor !== 1 ? (
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-parchment/85">
                      <span className="text-muted">Costs:</span>
                      {hasCost ? <CostRow cost={o.cost} have={have} /> : null}
                      {o.extraMs > 0 ? <span className="num">+{fmtDuration(o.extraMs)} to decide</span> : null}
                      {o.supplyFactor !== 1 ? <span className="num">×{o.supplyFactor} supplies</span> : null}
                    </span>
                  ) : null}
                  {o.counteredByKnownStance ? <span className="block font-bold text-vermilion-bright">Your scouts say the garrison is ready for exactly this.</span> : null}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
