'use client';

/**
 * The "Strategy" section of a battle report: the attacker's tactic against the
 * defender's stance, how it turned out and what it was worth. Everything is
 * read from the stored battle inputs, so it shows exactly what the server
 * resolved.
 */
import type { BattleInputs } from '@/game/battle';
import { STANCE_DEFS, TACTIC_DEFS, type StrategySideEffect } from '@/game/strategy';
import { Icon } from '@/components/icons';
import { cx } from '@/lib/format';
import { STANCE_ICON, TACTIC_ICON, chanceLabel } from './strategy';
import { Panel } from './ui';

type Strategy = NonNullable<BattleInputs['strategy']>;

const pct = (n: number) => `${n > 0 ? '+' : '−'}${Math.round(Math.abs(n) * 100)}%`;
const flat = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(Math.round(n))}`;

function effects(e: StrategySideEffect): { text: string; good: boolean }[] {
  const out: { text: string; good: boolean }[] = [];
  if (e.attack) out.push({ text: `${pct(e.attack)} damage`, good: e.attack > 0 });
  if (e.toughness) out.push({ text: `${pct(e.toughness)} protection`, good: e.toughness > 0 });
  if (e.firstRound) out.push({ text: `${pct(e.firstRound)} damage in the opening round`, good: e.firstRound > 0 });
  if (e.siege) out.push({ text: `${Math.round(e.siege * 100)}% of the castle bonus ignored`, good: e.siege > 0 });
  if (e.morale) out.push({ text: `${flat(e.morale)} morale`, good: e.morale > 0 });
  return out;
}

function verdict(s: Strategy): { title: string; detail: string; favours: 'attacker' | 'defender' | 'none' } {
  if (s.tacticResult === 'countered') {
    return { title: `${s.tacticName} was countered`, detail: `The garrison stood in ${s.stanceName}, the one stance that defeats it.`, favours: 'defender' };
  }
  if (s.stanceResult === 'sprung') {
    return { title: 'The ambush was sprung', detail: 'The attackers had no scouting report and marched into it.', favours: 'defender' };
  }
  if (s.stanceResult === 'revealed') {
    return { title: 'The ambush was revealed by scouts', detail: 'The attackers knew where the garrison lay and caught it outside its walls.', favours: 'attacker' };
  }
  if (s.tacticResult === 'succeeded') {
    return {
      title: `${s.tacticName} came off`,
      detail: `The garrison was not ready for it${s.chance !== null ? `; it had a ${chanceLabel(s.chance)} chance` : ''}.`,
      favours: 'attacker',
    };
  }
  if (s.tacticResult === 'failed') {
    return {
      title: `${s.tacticName} miscarried`,
      detail: `Nothing countered it, but the plan fell apart in the execution${s.chance !== null ? ` (it had a ${chanceLabel(s.chance)} chance)` : ''}.`,
      favours: 'defender',
    };
  }
  return { title: 'A plain assault', detail: 'No tactic to counter, and nothing gained by it.', favours: 'none' };
}

export function StrategyReport({ inputs, youAttack }: { inputs: BattleInputs; youAttack: boolean }) {
  const s = inputs.strategy;
  if (!s) return null;
  const tactic = TACTIC_DEFS[s.tactic];
  const stance = STANCE_DEFS[s.stance];
  const v = verdict(s);
  const forYou = v.favours === 'none' ? 'none' : (v.favours === 'attacker') === youAttack ? 'good' : 'bad';
  const a = effects(s.attacker);
  const d = effects(s.defender);
  const walls = s.positionFactor < 1 ? `Castle and terrain counted for only ${Math.round(s.positionFactor * 100)}% of their worth.` : null;

  return (
    <Panel title="Strategy" icon="tactic">
      <div className="grid items-stretch gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="panel-flat p-3">
          <p className="text-[0.66rem] uppercase tracking-wider text-muted">The attacker&apos;s tactic</p>
          <div className="mt-1 flex items-center gap-2.5">
            <span className="seal seal-sm" aria-hidden>
              <Icon name={TACTIC_ICON[s.tactic]} />
            </span>
            <div className="min-w-0 leading-tight">
              <p className="font-display text-lg font-bold">{s.tacticName}</p>
              <p className="text-xs italic text-muted">{tactic.maxim}</p>
            </div>
          </div>
          {inputs.attacker.commander ? (
            <p className="mt-2 text-sm text-parchment/85">
              Led by <strong>{inputs.attacker.commander}</strong>, who fought with their own Military skill.
            </p>
          ) : null}
          <p className="mt-1 text-sm text-muted">{s.attackerHadIntel ? 'The attackers held a fresh scouting report.' : 'The attackers had no scouting report.'}</p>
        </div>
        <div className="grid place-items-center font-display text-sm font-bold uppercase tracking-[0.2em] text-muted">against</div>
        <div className="panel-flat p-3">
          <p className="text-[0.66rem] uppercase tracking-wider text-muted">The defender&apos;s stance</p>
          <div className="mt-1 flex items-center gap-2.5">
            <span className="seal seal-sm seal-ink" aria-hidden>
              <Icon name={STANCE_ICON[s.stance]} />
            </span>
            <div className="min-w-0 leading-tight">
              <p className="font-display text-lg font-bold">{s.stanceName}</p>
              <p className="text-xs italic text-muted">{stance.maxim}</p>
            </div>
          </div>
          <p className="mt-2 text-sm text-parchment/85">{stance.counters ? `Defeats ${TACTIC_DEFS[stance.counters].name}.` : s.stance === 'ambush' ? 'Answered only by scouts who find it first.' : 'Defeats no particular tactic.'}</p>
        </div>
      </div>

      <div
        className={cx(
          'mt-3 flex items-start gap-3 rounded-[3px] border px-3.5 py-3',
          forYou === 'good' ? 'border-jade/50 bg-jade/10' : forYou === 'bad' ? 'border-vermilion/50 bg-vermilion/10' : 'border-gold/25 bg-ink-900/60',
        )}
      >
        <Icon name={forYou === 'good' ? 'check' : forYou === 'bad' ? 'alert' : 'dot'} className={cx('mt-1 shrink-0', forYou === 'good' ? 'text-jade' : forYou === 'bad' ? 'text-vermilion-bright' : 'text-muted')} />
        <div className="min-w-0">
          <p className="font-display text-lg font-bold leading-tight">{v.title}</p>
          <p className="text-sm text-parchment/85">{v.detail}</p>
          {forYou !== 'none' ? <p className={cx('mt-0.5 text-xs font-bold uppercase tracking-wider', forYou === 'good' ? 'text-jade' : 'text-vermilion-bright')}>{forYou === 'good' ? 'In your favour' : 'Against you'}</p> : null}
        </div>
      </div>

      {a.length > 0 || d.length > 0 || walls ? (
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <EffectList title="What it did to the attacker" items={a} />
          <EffectList title="What it did to the defender" items={d} extra={walls} />
        </dl>
      ) : null}

      {s.notes.length > 0 ? (
        <ol className="mt-3 space-y-1 border-t border-gold/15 pt-3 text-sm text-parchment/85">
          {s.notes.map((note, i) => (
            <li key={i} className="flex gap-2">
              <span className="num w-4 shrink-0 text-muted">{i + 1}.</span>
              <span>{note}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </Panel>
  );
}

function EffectList({ title, items, extra }: { title: string; items: { text: string; good: boolean }[]; extra?: string | null }) {
  return (
    <div>
      <dt className="text-[0.66rem] uppercase tracking-wider text-muted">{title}</dt>
      <dd className="mt-1">
        {items.length === 0 && !extra ? (
          <span className="text-muted">Nothing.</span>
        ) : (
          <ul className="space-y-0.5">
            {items.map((e) => (
              <li key={e.text} className={cx('num', e.good ? 'text-jade' : 'text-vermilion-bright')}>
                {e.text}
              </li>
            ))}
            {extra ? <li className="text-vermilion-bright">{extra}</li> : null}
          </ul>
        )}
      </dd>
    </div>
  );
}
