'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { BattleDetailResponse } from '@/game/api';
import { OUTCOME_LABEL, WEATHER_INFO, type BattleResult, type BattleRound, type BattleSide } from '@/game/battle';
import { TERRAIN_INFO, UNITS, UNIT_TYPES, totalUnits, type UnitCounts } from '@/game/config';
import { Countdown, ErrorState, LoadingState, Panel } from '@/components/ui';
import { EVENTS } from '@/lib/events';
import { cx, fmt, fmtDateTime, fmtPct } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { RESULT_STYLE, viewerResult } from '@/lib/world';

import { Icon } from '@/components/icons';
export default function BattleReportPage() {
  const { id } = useParams<{ id: string }>();
  const state = useApi<BattleDetailResponse>(id ? `/api/battles/${id}` : null, EVENTS.battles);

  return (
    <div>
      <Link href="/game/military" className="mb-3 inline-flex min-h-[44px] items-center gap-1.5 text-sm text-muted hover:text-parchment">
        ← Back to military
      </Link>
      {state.error && !state.data ? (
        <ErrorState message={state.error.message} onRetry={() => void state.refresh()} />
      ) : !state.data ? (
        <LoadingState label="Unsealing the report…" />
      ) : (
        <Report data={state.data} onRefresh={() => void state.refresh()} />
      )}
    </div>
  );
}

const HEADLINE: Record<string, { attacker: string; defender: string }> = {
  decisive_victory: { attacker: 'A crushing victory', defender: 'A crushing defeat' },
  victory: { attacker: 'Victory', defender: 'Defeat' },
  draw: { attacker: 'The field is undecided', defender: 'The walls held' },
  defeat: { attacker: 'Defeat', defender: 'Victory' },
  retreat: { attacker: 'Your army withdrew', defender: 'The enemy was driven off' },
};

function Report({ data, onRefresh }: { data: BattleDetailResponse; onRefresh: () => void }) {
  const { battle: b, result, inputs, weather, seed, verified } = data;
  const view = viewerResult(b);
  const style = RESULT_STYLE[view];
  const youAttack = b.role === 'attacker';

  if (b.status === 'pending' || !result || !inputs) {
    return (
      <div className="space-y-4">
        <section className="paper p-5 text-center sm:p-8">
          <span className="seal seal-lg mx-auto" aria-hidden>
            戦
          </span>
          <h1 className="mt-3 font-display text-3xl font-extrabold">Battle for {b.provinceName}</h1>
          <p className="mt-1 font-display text-lg">
            {b.attackerName} against {b.defenderName}
          </p>
          {b.status === 'cancelled' ? (
            <p className="mt-4 text-sm">The battle was called off before blades were drawn — the province changed hands or the war ended first.</p>
          ) : (
            <>
              <p className="mt-5 text-sm uppercase tracking-[0.15em] text-ink-600">The outcome will be known in</p>
              <p className="font-display text-5xl font-extrabold text-vermilion-deep">
                <Countdown to={b.resolvesAt} done="any moment" onDone={onRefresh} />
              </p>
              <p className="mx-auto mt-4 max-w-md text-sm">
                {youAttack ? 'Your army is fighting at the walls.' : 'Your garrison is holding the walls.'} Reinforcements that arrive before the battle ends still count.
              </p>
            </>
          )}
        </section>
      </div>
    );
  }

  const headline = HEADLINE[result.outcome][b.role];
  const you = youAttack ? inputs.attacker : inputs.defender;
  const terrain = TERRAIN_INFO[inputs.province.terrain];
  const w = WEATHER_INFO[weather ?? inputs.weather];
  const maxMen = Math.max(totalUnits(inputs.attacker.units), totalUnits(inputs.defender.units), 1);

  return (
    <div className="space-y-4 lg:space-y-5">
      {/* outcome banner */}
      <section className="paper overflow-hidden">
        <div className={cx('h-2', view === 'won' ? 'bg-gold' : view === 'lost' ? 'bg-vermilion' : 'bg-ink-500')} />
        <div className="flex flex-col items-center gap-2 p-5 text-center sm:p-7">
          <span className={cx('seal seal-lg', view === 'won' && 'seal-gold', view === 'draw' && 'seal-ink')} aria-hidden>
            {style.kanji}
          </span>
          <p className="text-[0.72rem] uppercase tracking-[0.2em] text-ink-600">
            {youAttack ? 'You attacked' : 'You defended'} · {b.resolvedAt ? fmtDateTime(b.resolvedAt) : ''}
          </p>
          <h1 className="font-display text-3xl font-extrabold leading-tight sm:text-4xl">{headline}</h1>
          <p className="font-display text-lg">
            Battle for <strong>{b.provinceName}</strong> — {b.attackerName} against {b.defenderName}
          </p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <span className="chip !whitespace-normal text-center">Official result: {OUTCOME_LABEL[result.outcome]} for the attacker</span>
            {b.provinceCaptured ? <span className="chip chip-red">{youAttack ? `${b.provinceName} is yours` : `${b.provinceName} has fallen`}</span> : null}
            <span className="chip">{result.rounds.length} {result.rounds.length === 1 ? 'round' : 'rounds'}</span>
          </div>
        </div>
      </section>

      {/* forces */}
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-5 [&>*]:min-w-0">
        <SidePanel title="Attacker" side={inputs.attacker} res={result.attacker} isYou={youAttack} pursuit={result.pursuit.side === 'attacker' ? result.pursuit.losses : null} won={result.winner === 'attacker'} />
        <SidePanel title="Defender" side={inputs.defender} res={result.defender} isYou={!youAttack} pursuit={result.pursuit.side === 'defender' ? result.pursuit.losses : null} won={result.winner === 'defender'} />
      </div>

      {/* conditions */}
      <Panel title="The field" kanji="地">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Condition label="Terrain" value={terrain.name} note={terrain.note} extra={terrain.defense > 1 ? `Defender +${fmtPct(terrain.defense - 1)}` : 'No advantage'} />
          <Condition label="Weather" value={w.name} note={w.note} />
          <Condition
            label="Castle"
            value={`Level ${inputs.province.castleLevel}`}
            note={inputs.attacker.mods.siege > 0 ? `Siege skill ignored ${fmtPct(Math.min(1, inputs.attacker.mods.siege))} of the walls.` : 'Walls at full strength.'}
            extra={`Defender +${fmtPct(result.castleBonus)}`}
          />
          <Condition label="Starting morale" value={`${Math.round(inputs.attacker.morale)} vs ${Math.round(inputs.defender.morale)}`} note="Attacker vs defender. A side breaks below 25 morale or at 30% strength." />
        </dl>
      </Panel>

      {/* rounds */}
      <Panel title="Round by round" kanji="陣" bodyClassName="p-0">
        {result.rounds.length === 0 ? (
          <p className="p-4 text-sm text-muted">{totalUnits(inputs.defender.units) === 0 ? 'The province was undefended and fell without a fight.' : 'No blows were exchanged.'}</p>
        ) : (
          <>
            <ol className="divide-y divide-gold/10 lg:hidden">
              {result.rounds.map((r) => (
                <RoundCard key={r.round} r={r} maxMen={maxMen} youAttack={youAttack} />
              ))}
            </ol>
            <div className="hidden overflow-x-auto lg:block">
              <table className="table-ink">
                <thead>
                  <tr>
                    <th>Round</th>
                    <th>Attacker strength</th>
                    <th className="!text-right">Lost</th>
                    <th className="!text-right">Morale</th>
                    <th>Defender strength</th>
                    <th className="!text-right">Lost</th>
                    <th className="!text-right">Morale</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rounds.map((r) => (
                    <tr key={r.round}>
                      <td className="font-display font-bold">{r.round}</td>
                      <td className="w-[24%]">
                        <StrengthBar value={r.attackerRemaining} max={maxMen} tone="red" />
                      </td>
                      <td className="num text-right text-vermilion-bright">−{fmt(totalUnits(r.attackerLosses))}</td>
                      <td className={cx('num text-right', r.attackerMorale < 25 && 'font-bold text-vermilion-bright')}>{Math.round(r.attackerMorale)}</td>
                      <td className="w-[24%]">
                        <StrengthBar value={r.defenderRemaining} max={maxMen} tone="gold" />
                      </td>
                      <td className="num text-right text-vermilion-bright">−{fmt(totalUnits(r.defenderLosses))}</td>
                      <td className={cx('num text-right', r.defenderMorale < 25 && 'font-bold text-vermilion-bright')}>{Math.round(r.defenderMorale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <Aftermath result={result} attackerName={b.attackerName} defenderName={b.defenderName} />
      </Panel>

      {/* provenance */}
      <section className="panel flex flex-wrap items-center gap-4 p-4">
        <div className={cx('grid h-16 w-16 shrink-0 rotate-[-6deg] place-items-center rounded-full border-2 font-display text-[0.6rem] font-bold uppercase leading-tight tracking-wider', verified ? 'border-jade text-jade' : 'border-muted text-muted')}>
          <span className="text-center">
            {verified ? (
              <>
                <span className="block text-lg leading-none">検</span>verified
              </>
            ) : (
              <>
                <span className="block text-lg leading-none">未</span>unchecked
              </>
            )}
          </span>
        </div>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-display text-base font-bold">{verified ? 'Verified reproducible' : verified === false ? 'Could not be reproduced' : 'Reproducibility not checked'}</p>
          <p className="text-muted">
            The server resolved this battle from stored inputs and a random seed. {verified ? 'Re-running the simulation with the same inputs and seed gives exactly this result.' : ''} Commander of record for your side:{' '}
            {you.name}.
          </p>
          {seed ? (
            <p className="num mt-1 break-all font-mono text-xs text-faint">
              seed {seed} · rules v{inputs.rules.version}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function SidePanel({ title, side, res, isYou, pursuit, won }: { title: string; side: BattleSide; res: BattleResult['attacker']; isYou: boolean; pursuit: UnitCounts | null; won: boolean }) {
  const initial = totalUnits(res.initial);
  const lost = totalUnits(res.losses);
  const types = UNIT_TYPES.filter((t) => res.initial[t] > 0);
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          {side.name}
          {isYou ? <span className="chip">You</span> : null}
          {won ? <span className="chip chip-jade">Held the field</span> : null}
        </span>
      }
      kanji={title === 'Attacker' ? '攻' : '守'}
      bodyClassName="p-0"
    >
      <div className="grid grid-cols-3 gap-2 border-b border-gold/10 p-4 text-center">
        <Mini label="Marched" value={fmt(initial)} />
        <Mini label="Fell" value={fmt(lost)} tone="red" />
        <Mini label="Remain" value={fmt(initial - lost)} tone="jade" />
      </div>
      {types.length === 0 ? (
        <p className="p-4 text-sm text-muted">No soldiers.</p>
      ) : (
        <table className="table-ink table-fixed">
          <thead>
            <tr>
              <th className="w-[40%]">Unit</th>
              <th className="!text-right">Start</th>
              <th className="!text-right">Lost</th>
              <th className="!text-right">Left</th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t}>
                <td>
                  <span className="flex items-center gap-2">
                    <span className="seal seal-sm seal-ink" aria-hidden>
                      <Icon name={t} />
                    </span>
                    {UNITS[t].name}
                  </span>
                </td>
                <td className="num text-right">{fmt(res.initial[t])}</td>
                <td className="num text-right text-vermilion-bright">{res.losses[t] > 0 ? `−${fmt(res.losses[t])}` : '0'}</td>
                <td className="num text-right font-bold">{fmt(res.remaining[t])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 p-4 text-xs text-muted">
        <span>Power {fmt(res.initialPower)}</span>
        <span>
          Morale {Math.round(side.morale)} → {Math.round(res.finalMorale)}
        </span>
        {side.mods.attack ? <span>Commander +{fmtPct(side.mods.attack, 1)} attack</span> : null}
        {side.mods.toughness ? <span>+{fmtPct(side.mods.toughness, 1)} toughness</span> : null}
        {pursuit && totalUnits(pursuit) > 0 ? <span className="text-vermilion-bright">{fmt(totalUnits(pursuit))} cut down in the rout</span> : null}
      </div>
    </Panel>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: 'red' | 'jade' }) {
  return (
    <div>
      <div className="text-[0.62rem] uppercase tracking-wider text-muted">{label}</div>
      <div className={cx('num font-display text-xl font-bold', tone === 'red' && 'text-vermilion-bright', tone === 'jade' && 'text-jade')}>{value}</div>
    </div>
  );
}

function Condition({ label, value, note, extra }: { label: string; value: string; note: string; extra?: string }) {
  return (
    <div className="panel-flat p-3">
      <dt className="text-[0.62rem] uppercase tracking-wider text-muted">{label}</dt>
      <dd className="font-display text-lg font-bold leading-tight">{value}</dd>
      {extra ? <dd className="text-xs font-bold text-gold">{extra}</dd> : null}
      <dd className="mt-1 text-xs leading-relaxed text-muted">{note}</dd>
    </div>
  );
}

function StrengthBar({ value, max, tone }: { value: number; max: number; tone: 'red' | 'gold' }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2.5 min-w-[3rem] flex-1 overflow-hidden rounded-sm bg-ink-950/70">
        <div className={cx('h-full', tone === 'red' ? 'bg-vermilion-bright' : 'bg-gold')} style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} />
      </div>
      <span className="num w-12 shrink-0 text-right text-sm font-bold">{fmt(value)}</span>
    </div>
  );
}

function RoundCard({ r, maxMen, youAttack }: { r: BattleRound; maxMen: number; youAttack: boolean }) {
  return (
    <li className="px-4 py-3">
      <div className="mb-2 font-display text-sm font-bold text-gold">Round {r.round}</div>
      <div className="space-y-2">
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted">
            <span>Attacker{youAttack ? ' (you)' : ''}</span>
            <span className="num">
              −{fmt(totalUnits(r.attackerLosses))} · morale {Math.round(r.attackerMorale)}
            </span>
          </div>
          <StrengthBar value={r.attackerRemaining} max={maxMen} tone="red" />
        </div>
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted">
            <span>Defender{!youAttack ? ' (you)' : ''}</span>
            <span className="num">
              −{fmt(totalUnits(r.defenderLosses))} · morale {Math.round(r.defenderMorale)}
            </span>
          </div>
          <StrengthBar value={r.defenderRemaining} max={maxMen} tone="gold" />
        </div>
      </div>
    </li>
  );
}

function Aftermath({ result, attackerName, defenderName }: { result: BattleResult; attackerName: string; defenderName: string }) {
  let text: string;
  const pursued = totalUnits(result.pursuit.losses);
  if (result.winner === 'attacker') {
    text = `${defenderName}'s line broke${pursued > 0 ? ` and ${fmt(pursued)} were cut down as they fled` : ''}. ${attackerName} holds the field.`;
  } else if (result.winner === 'defender') {
    text = `${attackerName}'s host ${result.outcome === 'retreat' ? 'withdrew in good order' : 'was broken'}${pursued > 0 ? `, losing ${fmt(pursued)} more in the pursuit` : ''}. ${defenderName} keeps the province.`;
  } else {
    text = 'Neither side could break the other. As night fell the attacker pulled back from the walls.';
  }
  return <p className="border-t border-gold/15 px-4 py-3 font-display text-[0.95rem] italic leading-relaxed text-parchment/85">{text}</p>;
}
