'use client';

import { useState } from 'react';
import type { PillarDTO, PillarsResponse, SkillStateDTO } from '@/game/api';
import { BRANCH_NAMES, MAX_PILLAR_LEVEL, PILLARS, PILLAR_DEFS, SKILLS, SKILL_BY_CODE, type ModifierKey, type Modifiers, type PillarId, type SkillDef } from '@/game/pillars';
import { ActionButton, Bar, ErrorState, LoadingState, PageHeader, Panel } from '@/components/ui';
import { apiPost } from '@/lib/api';
import { EVENTS } from '@/lib/events';
import { cx, fmt } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

import { Glyph, Icon } from '@/components/icons';
const MOD_LABELS: Record<ModifierKey, { label: string; kind: 'pct' | 'flat'; sign?: -1 }> = {
  attack: { label: 'Army attack', kind: 'pct' },
  toughness: { label: 'Army toughness', kind: 'pct' },
  defense: { label: 'Toughness when defending', kind: 'pct' },
  infantry: { label: 'Infantry damage', kind: 'pct' },
  ranged: { label: 'Ranged damage', kind: 'pct' },
  cavalry: { label: 'Cavalry damage', kind: 'pct' },
  siege: { label: 'Castle defense ignored', kind: 'pct' },
  marchSpeed: { label: 'March speed', kind: 'pct' },
  capacity: { label: 'Army capacity', kind: 'flat' },
  morale: { label: 'Starting morale', kind: 'flat' },
  enemyMorale: { label: 'Enemy starting morale', kind: 'flat', sign: -1 },
  firstRound: { label: 'Opening-round damage', kind: 'pct' },
  intelAttack: { label: 'Attack with fresh intel', kind: 'pct' },
  prodAll: { label: 'All production', kind: 'pct' },
  prodFood: { label: 'Food production', kind: 'pct' },
  prodGold: { label: 'Gold income', kind: 'pct' },
  prodMaterials: { label: 'Wood, stone and iron', kind: 'pct' },
  buildCost: { label: 'Building cost', kind: 'pct', sign: -1 },
  buildTime: { label: 'Build time', kind: 'pct', sign: -1 },
  upkeep: { label: 'Army upkeep', kind: 'pct', sign: -1 },
  loyaltyPerDay: { label: 'Loyalty per day', kind: 'flat' },
  popGrowth: { label: 'Population growth', kind: 'pct' },
  conquestLoyalty: { label: 'Loyalty of conquered land', kind: 'flat' },
  scoutSuccess: { label: 'Scouting success', kind: 'pct' },
  scoutDefense: { label: 'Enemy scouting success', kind: 'pct', sign: -1 },
  scoutCost: { label: 'Scouting cost', kind: 'pct', sign: -1 },
  scoutTime: { label: 'Scouting time', kind: 'pct', sign: -1 },
  detect: { label: 'Spy detection', kind: 'pct' },
  reportDuration: { label: 'Scout report lifetime', kind: 'pct' },
  warCost: { label: 'War declaration cost', kind: 'pct', sign: -1 },
  festival: { label: 'Festival effect', kind: 'pct' },
  xpGain: { label: 'Experience gained', kind: 'pct' },
};

function modText(key: ModifierKey, value: number): string {
  const meta = MOD_LABELS[key];
  const signed = value * (meta.sign ?? 1);
  const abs = Math.abs(signed);
  const num = meta.kind === 'pct' ? `${(abs * 100).toFixed(abs * 100 < 10 && Math.round(abs * 1000) % 10 !== 0 ? 1 : 0)}%` : `${Number(abs.toFixed(2))}`;
  return `${signed < 0 ? '−' : '+'}${num}`;
}

export default function PillarsPage() {
  const state = useApi<PillarsResponse>('/api/pillars/me', EVENTS.pillars);
  const [selected, setSelected] = useState<PillarId>('military');
  const action = useAction();

  if (state.error && !state.data) return <ErrorState message={state.error.message} onRetry={() => void state.refresh()} />;
  if (!state.data) return <LoadingState label="Meditating on the Five Pillars…" />;
  const data = state.data;
  const pillarById = new Map(data.pillars.map((p) => [p.id, p]));
  const skillByCode = new Map(data.skills.map((s) => [s.code, s]));
  const pillar = pillarById.get(selected);
  const def = PILLAR_DEFS[selected];
  const totalPoints = data.pillars.reduce((s, p) => s + p.points, 0);
  const skills = SKILLS.filter((s) => s.pillar === selected);
  const core = skills.filter((s) => !s.branch);
  const branch = skills.filter((s) => s.branch);

  const learn = (skill: SkillDef) =>
    action.run(
      async () => {
        const res = await apiPost<PillarsResponse>('/api/skills/unlock', { skillCode: skill.code });
        state.setData(res);
        return res;
      },
      { success: (res) => `${skill.name} — rank ${res.skills.find((s) => s.code === skill.code)?.rank ?? ''} learned.` },
    );

  return (
    <div>
      <PageHeader
        kanji="柱"
        title="The Five Pillars"
        subtitle="What your Daimyo does, your Daimyo becomes. Each level grants a skill point for that pillar."
        action={totalPoints > 0 ? <span className="chip shrink-0">{totalPoints} to spend</span> : undefined}
      />

      {/* pillar selector */}
      <div className="mb-4 grid grid-cols-5 gap-1.5 sm:gap-3 lg:mb-5" role="tablist" aria-label="Pillars">
        {PILLARS.map((id) => {
          const p = pillarById.get(id);
          const d = PILLAR_DEFS[id];
          const active = id === selected;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSelected(id)}
              className={cx(
                'relative flex min-h-[92px] flex-col items-center gap-1 rounded-[4px] border px-1 py-2.5 text-center transition-colors sm:px-3 sm:py-3.5',
                active ? 'border-gold bg-gold/12' : 'border-gold/20 bg-ink-800/60 hover:border-gold/50',
              )}
            >
              <span className={cx('seal sm:!h-12 sm:!w-12 sm:!text-[1.6rem]', !active && 'seal-ink')} aria-hidden>
                <Icon name={d.id} />
              </span>
              <span className="hidden font-display text-sm font-bold leading-tight sm:block lg:text-base">{d.name}</span>
              <span className="font-display text-[0.62rem] font-bold leading-tight sm:hidden">{d.name.split(' ')[0]}</span>
              <span className="num text-xs text-gold">Lv {p?.level ?? 1}</span>
              {p ? <XpBar p={p} className="mt-0.5 hidden w-full sm:block" /> : null}
              {p && p.points > 0 ? (
                <span className="num absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-sm bg-vermilion px-1 text-[0.66rem] font-bold text-parchment-light shadow" aria-label={`${p.points} skill points`}>
                  {p.points}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-5">
        <div className="space-y-4 lg:space-y-5">
          {/* pillar summary */}
          <section className="paper p-4 sm:p-5">
            <div className="flex items-start gap-4">
              <div className="grid h-16 w-16 shrink-0 place-items-center border-2 border-ink-900 font-display text-4xl font-bold text-vermilion-deep"><Glyph k={def.kanji} /></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <h2 className="font-display text-2xl font-extrabold leading-tight">{def.name}</h2>
                  <span className="num font-display text-lg font-bold">
                    Level {pillar?.level ?? 1}
                    <span className="text-sm font-normal text-ink-600"> / {MAX_PILLAR_LEVEL}</span>
                  </span>
                </div>
                <p className="font-display text-[0.95rem] italic">{def.purpose}</p>
                {pillar ? (
                  <div className="mt-2.5">
                    <XpBar p={pillar} />
                    <p className="num mt-1 text-xs text-ink-700">
                      {pillar.xpToNext !== null ? `${fmt(pillar.xp)} / ${fmt(pillar.xpToNext)} experience to level ${pillar.level + 1}` : 'Mastered — this pillar can rise no higher'}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="mt-3 grid gap-x-6 gap-y-1 border-t border-ink-900/20 pt-3 text-sm sm:grid-cols-2">
              <p>
                <span className="font-bold">Each level: </span>
                {def.perLevelText}
              </p>
              <p>
                <span className="font-bold">Grows by: </span>
                {def.xpSources.join(' · ')}
              </p>
            </div>
          </section>

          {/* skill tree */}
          <Panel
            title="Skills"
            kanji="技"
            action={<span className={cx('chip', (pillar?.points ?? 0) === 0 && 'chip-muted')}>{pillar?.points ?? 0} {(pillar?.points ?? 0) === 1 ? 'point' : 'points'}</span>}
            bodyClassName="p-3 sm:p-4"
          >
            <ul className="grid gap-3 md:grid-cols-3">
              {core.map((s) => (
                <SkillCard key={s.code} skill={s} state={skillByCode.get(s.code)} pillarLevel={pillar?.level ?? 1} skillByCode={skillByCode} busy={action.busy} onLearn={() => void learn(s)} />
              ))}
            </ul>

            {branch.length > 0 ? (
              <div className="mt-5">
                <div className="mb-3 flex items-center gap-3">
                  <span className="h-px flex-1 bg-gradient-to-r from-transparent to-gold/50" />
                  <span className="text-center font-display text-sm font-bold uppercase tracking-[0.14em] text-gold">
                    {BRANCH_NAMES[branch[0].branch!] ?? 'Specialization'} — choose one path
                  </span>
                  <span className="h-px flex-1 bg-gradient-to-l from-transparent to-gold/50" />
                </div>
                <ul className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr]">
                  {branch.map((s, i) => (
                    <FragmentWithOr key={s.code} showOr={i > 0}>
                      <SkillCard skill={s} state={skillByCode.get(s.code)} pillarLevel={pillar?.level ?? 1} skillByCode={skillByCode} busy={action.busy} onLearn={() => void learn(s)} branch />
                    </FragmentWithOr>
                  ))}
                </ul>
                <p className="mt-2 text-center text-xs text-muted">Learning one path closes the other for good. Specialization is what sets one Daimyo apart from another.</p>
              </div>
            ) : null}
          </Panel>
        </div>

        <ModifierSummary modifiers={data.modifiers} />
      </div>
    </div>
  );
}

function FragmentWithOr({ showOr, children }: { showOr: boolean; children: React.ReactNode }) {
  return (
    <>
      {showOr ? (
        <li className="flex items-center justify-center" aria-hidden>
          <span className="grid h-9 w-9 place-items-center rounded-full border border-gold/40 font-display text-sm italic text-gold">or</span>
        </li>
      ) : null}
      {children}
    </>
  );
}

function XpBar({ p, className }: { p: PillarDTO; className?: string }) {
  return <Bar className={className} value={p.xpToNext === null ? 1 : p.xp} max={p.xpToNext === null ? 1 : p.xpToNext} label="Experience" />;
}

function SkillCard({
  skill,
  state,
  pillarLevel,
  skillByCode,
  busy,
  onLearn,
  branch,
}: {
  skill: SkillDef;
  state: SkillStateDTO | undefined;
  pillarLevel: number;
  skillByCode: Map<string, SkillStateDTO>;
  busy: boolean;
  onLearn: () => void;
  branch?: boolean;
}) {
  const rank = state?.rank ?? 0;
  const mastered = rank >= skill.maxRank;
  const reason = mastered ? null : (state?.blockedReason ?? null);
  const closed = Boolean(reason && reason.startsWith('Locked'));
  const requirements: { text: string; met: boolean }[] = [];
  if (skill.requiresLevel > 1) requirements.push({ text: `${PILLAR_DEFS[skill.pillar].name} level ${skill.requiresLevel}`, met: pillarLevel >= skill.requiresLevel });
  for (const req of skill.requiresSkills) {
    requirements.push({ text: `${SKILL_BY_CODE[req.code]?.name ?? req.code} rank ${req.rank}`, met: (skillByCode.get(req.code)?.rank ?? 0) >= req.rank });
  }
  return (
    <li className={cx('flex flex-col rounded-[3px] border p-3.5', rank > 0 ? 'border-gold/55 bg-gold/8' : 'border-gold/15 bg-ink-800/60', closed && 'opacity-55', branch && 'md:min-h-[15rem]')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-display text-[1.05rem] font-bold leading-tight">{skill.name}</h3>
          <p className="text-[0.66rem] uppercase tracking-wider text-muted">{skill.category}</p>
        </div>
        <div className="flex shrink-0 gap-1 pt-1" role="img" aria-label={`Rank ${rank} of ${skill.maxRank}`}>
          {Array.from({ length: skill.maxRank }, (_, i) => (
            <span key={i} className={cx('h-2.5 w-2.5 rotate-45 border', i < rank ? 'border-gold bg-gold' : 'border-gold/40')} />
          ))}
        </div>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-parchment/80">{skill.description}</p>
      <p className="mt-2 text-sm font-medium text-gold-bright">{skill.effectText}</p>
      {requirements.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-xs">
          {requirements.map((r) => (
            <li key={r.text} className={r.met ? 'text-jade' : 'text-muted'}>
              {r.met ? '✓' : '○'} Requires {r.text}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-auto pt-3">
        {mastered ? (
          <p className="text-center font-display text-sm font-bold text-gold">Mastered</p>
        ) : (
          <ActionButton variant={reason ? 'default' : 'gold'} size="sm" reason={reason} busy={busy} onClick={onLearn} wrapperClassName="flex w-full" className="w-full">
            {rank === 0 ? 'Learn' : `Train to rank ${rank + 1}`}
          </ActionButton>
        )}
      </div>
    </li>
  );
}

function ModifierSummary({ modifiers }: { modifiers: Modifiers }) {
  const active = (Object.keys(MOD_LABELS) as ModifierKey[]).filter((k) => Math.abs(modifiers[k] ?? 0) > 1e-9);
  return (
    <Panel title="What your pillars grant" kanji="効" className="self-start">
      {active.length === 0 ? (
        <p className="text-sm text-muted">No bonuses yet. Every pillar level and every skill rank adds to this list, and the server applies it to your economy, armies and spies.</p>
      ) : (
        <dl className="divide-y divide-gold/10">
          {active.map((k) => (
            <div key={k} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
              <dt className="text-parchment/85">{MOD_LABELS[k].label}</dt>
              <dd className="num font-bold text-gold-bright">{modText(k, modifiers[k])}</dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}
