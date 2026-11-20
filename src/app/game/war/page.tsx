'use client';

/**
 * The War Council: the nation plans its attacks together.
 *
 * A plan names a target, a host, a tactic and a commander; officials are given
 * duties and accept them; when the council marks the plan ready, its commander
 * (or an official who may command) launches it. Everything shown here comes
 * from GET /api/war — the server decides what is allowed and what it is worth.
 */
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MarchPreviewResponse, TacticOptionDTO, WarAssignmentDTO, WarCouncilResponse, WarPlanDTO, WarPlanRequest } from '@/game/api';
import { OUTCOME_LABEL, type BattleOutcome } from '@/game/battle';
import { DUTY_DEFS, WAR_DUTIES, type WarDuty } from '@/game/clan';
import { TERRAIN_INFO, UNITS, UNIT_TYPES, emptyUnits, totalUnits, type UnitCounts } from '@/game/config';
import { TACTICS, TACTIC_DEFS, tacticBlockReason, tacticChance, type TacticId } from '@/game/strategy';
import { PlayerLink } from '@/components/clan';
import { Icon } from '@/components/icons';
import { Portrait } from '@/components/Portrait';
import { CounterLegend, KnownStanceNote, TacticCard, TacticPicker, TacticSeal, chanceLabel, tacticDefeatedBy, type KnownStance } from '@/components/strategy';
import { ActionButton, ConfirmDialog, Countdown, EmptyState, ErrorState, LoadingState, NumberStepper, PageHeader, Panel, UnitsRow } from '@/components/ui';
import { ApiError, apiPost } from '@/lib/api';
import { useNow } from '@/lib/clock';
import { EVENTS } from '@/lib/events';
import { cx, fmt, fmtDateTime, fmtDuration } from '@/lib/format';
import { useGame } from '@/lib/game-context';
import { useAction, useApi, useDebounced, useIsDesktop } from '@/lib/hooks';

type Mutate = (fn: () => Promise<WarCouncilResponse>, success: string) => Promise<WarCouncilResponse | undefined>;

const STATUS: Record<WarPlanDTO['status'], { label: string; chip: string }> = {
  draft: { label: 'Draft', chip: 'chip chip-muted' },
  ready: { label: 'Ready', chip: 'chip chip-jade' },
  launched: { label: 'On the march', chip: 'chip chip-red' },
  completed: { label: 'Fought', chip: 'chip' },
  cancelled: { label: 'Cancelled', chip: 'chip chip-muted' },
};

const RELATION: Record<string, { label: string; chip: string; note: string | null }> = {
  enemy: { label: 'At war', chip: 'chip chip-red', note: null },
  unclaimed: { label: 'Unclaimed', chip: 'chip', note: null },
  foreign: { label: 'Not at war', chip: 'chip chip-muted', note: 'War must be declared before the plan can be launched.' },
  allied: { label: 'Allied', chip: 'chip chip-jade', note: 'An ally cannot be attacked while the alliance stands.' },
  own: { label: 'Yours', chip: 'chip chip-muted', note: null },
};

function outcomeLabel(outcome: string | null): string | null {
  if (!outcome) return null;
  return OUTCOME_LABEL[outcome as BattleOutcome] ?? outcome.charAt(0).toUpperCase() + outcome.slice(1);
}

export default function WarCouncilPage() {
  const state = useApi<WarCouncilResponse>('/api/war', EVENTS.war);
  const action = useAction();
  const desktop = useIsDesktop();
  const [selected, setSelected] = useState<string | null>(null);
  /** null: not editing. 'new': drafting a plan. Otherwise the id of the plan being changed. */
  const [editing, setEditing] = useState<string | null>(null);
  const { refreshMe } = useGame();

  // Removed from the nation, or the nation fell, while the council was open: catch up with the session at once.
  const lost = state.error instanceof ApiError && (state.error.code === 'NO_CLAN' || state.error.code === 'CLAN_FALLEN');
  useEffect(() => {
    if (lost) void refreshMe();
  }, [lost, refreshMe]);

  const plans = useMemo(() => state.data?.plans ?? [], [state.data]);
  // On a wide screen there is always a plan open beside the list.
  useEffect(() => {
    if (!desktop || editing || plans.length === 0) return;
    if (!selected || !plans.some((p) => p.id === selected)) setSelected(plans[0].id);
  }, [desktop, editing, plans, selected]);

  if (state.error && !state.data) return <ErrorState message={state.error.message} onRetry={() => void state.refresh()} />;
  if (!state.data) return <LoadingState label="The council is gathering…" />;
  const council = state.data;

  const mutate: Mutate = (fn, success) =>
    action.run(
      async () => {
        const res = await fn();
        state.setData(res);
        return res;
      },
      { success },
    );

  const open = plans.filter((p) => p.status === 'draft' || p.status === 'ready' || p.status === 'launched');
  const history = plans.filter((p) => p.status === 'completed' || p.status === 'cancelled');
  const current = plans.find((p) => p.id === selected) ?? null;
  const showList = desktop || (!current && !editing);
  const showDetail = desktop || !!current || !!editing;

  const startNew = () => {
    setEditing('new');
    setSelected(null);
  };

  return (
    <div>
      <PageHeader
        icon="war"
        title="War Council"
        subtitle="Plan the attack together: a target, a host, a tactic, a commander, and a duty for every official."
        action={
          council.canPlan && !editing ? (
            <button type="button" className="btn btn-gold shrink-0" onClick={startNew}>
              <Icon name="plus" /> <span className="hidden sm:inline">New plan</span>
              <span className="sm:hidden">New</span>
            </button>
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-5">
        {showList ? (
          <div className="space-y-4 lg:space-y-5">
            <Panel title="Open plans" icon="war" bodyClassName="p-0">
              {open.length === 0 ? (
                <EmptyState icon="war" title="No plan on the table" className="!py-6">
                  {council.canPlan ? 'Draft the first one: choose a target and a tactic, then give your officials their duties.' : 'When the council drafts a plan, it appears here with your duties.'}
                </EmptyState>
              ) : (
                <ul className="divide-y divide-gold/10">
                  {open.map((p) => (
                    <PlanRow key={p.id} plan={p} active={p.id === selected && !editing} onOpen={() => (setEditing(null), setSelected(p.id))} />
                  ))}
                </ul>
              )}
            </Panel>
            {history.length > 0 ? (
              <Panel title="Past plans" icon="history" bodyClassName="p-0">
                <ul className="divide-y divide-gold/10">
                  {history.map((p) => (
                    <PlanRow key={p.id} plan={p} active={p.id === selected && !editing} onOpen={() => (setEditing(null), setSelected(p.id))} />
                  ))}
                </ul>
              </Panel>
            ) : null}
            <Panel title="How strategy works" icon="tactic">
              <p className="mb-2.5 text-sm text-parchment/85">
                Every tactic has one stance that defeats it. Guess wrong and the attack is worse than a plain assault; scout first and you choose knowing how the garrison stands.
              </p>
              <CounterLegend />
            </Panel>
          </div>
        ) : null}

        {showDetail ? (
          <div className="min-w-0 space-y-4 lg:space-y-5">
            {!desktop ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => (setEditing(null), setSelected(null))}>
                ← All plans
              </button>
            ) : null}
            {editing ? (
              <PlanEditor
                key={editing}
                council={council}
                plan={editing === 'new' ? null : (plans.find((p) => p.id === editing) ?? null)}
                busy={action.busy}
                onCancel={() => setEditing(null)}
                onSave={async (body, planId) => {
                  const before = new Set(plans.map((p) => p.id));
                  const res = await mutate(
                    () => apiPost<WarCouncilResponse>(planId ? `/api/war/plans/${planId}` : '/api/war/plans', body),
                    planId ? 'The plan is changed.' : 'The plan is on the table.',
                  );
                  if (!res) return;
                  setEditing(null);
                  setSelected(planId ?? res.plans.find((p) => !before.has(p.id))?.id ?? res.plans[0]?.id ?? null);
                }}
              />
            ) : current ? (
              <PlanDetail key={current.id} plan={current} council={council} busy={action.busy} mutate={mutate} onEdit={() => setEditing(current.id)} />
            ) : (
              <Panel>
                <EmptyState icon="war" title="Choose a plan">
                  {council.canPlan ? 'Open a plan from the list, or draft a new one.' : 'Open a plan from the list to see your part in it.'}
                </EmptyState>
              </Panel>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function PlanRow({ plan, active, onOpen }: { plan: WarPlanDTO; active: boolean; onOpen: () => void }) {
  const mine = plan.assignments.filter((a) => a.isYou && a.status === 'assigned').length;
  const outcome = outcomeLabel(plan.outcome);
  return (
    <li>
      <button type="button" onClick={onOpen} className={cx('flex w-full items-start gap-3 px-4 py-3 text-left transition-colors', active ? 'bg-gold/10' : 'hover:bg-gold/5')}>
        <TacticSeal tactic={plan.tactic} tone={active ? 'gold' : 'ink'} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-display text-base font-bold">{plan.title}</span>
            <span className={STATUS[plan.status].chip}>{STATUS[plan.status].label}</span>
            {mine > 0 ? <span className="chip chip-red">Your answer needed</span> : null}
          </span>
          <span className="mt-0.5 block truncate text-sm text-parchment/80">
            {plan.targetName} · {TACTIC_DEFS[plan.tactic].name}
          </span>
          <span className="block truncate text-xs text-muted">
            {plan.commander ? `Commander ${plan.commander.nickname}` : 'No commander yet'}
            {outcome && (plan.status === 'completed' || plan.status === 'cancelled') ? ` · ${outcome}` : ''}
          </span>
        </span>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// One plan
// ---------------------------------------------------------------------------

function Section({ title, icon, children, defaultOpen = true }: { title: string; icon: Parameters<typeof Panel>[0]['icon']; children: React.ReactNode; defaultOpen?: boolean }) {
  const desktop = useIsDesktop();
  const [open, setOpen] = useState(defaultOpen);
  if (desktop) {
    return (
      <Panel title={title} icon={icon}>
        {children}
      </Panel>
    );
  }
  // On a phone every section folds away, so the plan stays readable.
  return (
    <section className="panel">
      <button type="button" className="flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="seal seal-sm seal-ink" aria-hidden>
          <Icon name={icon ?? 'scroll'} />
        </span>
        <span className="min-w-0 flex-1 truncate font-display text-[1.02rem] font-bold tracking-wide text-parchment">{title}</span>
        <span className="text-muted" aria-hidden>
          {open ? '−' : '+'}
        </span>
      </button>
      {open ? <div className="border-t border-gold/15 p-4">{children}</div> : null}
    </section>
  );
}

function planOption(plan: WarPlanDTO, tickMs: number): TacticOptionDTO {
  const def = TACTIC_DEFS[plan.tactic];
  return {
    id: plan.tactic,
    blockedReason: null,
    chance: plan.chance,
    cost: def.cost,
    extraMs: (def.extraMinutes * tickMs) / 60,
    supplyFactor: def.supplyFactor,
    counteredByKnownStance: !!plan.knownStance?.countersTactic,
  };
}

function bonusLines(plan: WarPlanDTO): string[] {
  const lines: string[] = [];
  if (plan.bonuses.chance > 0) lines.push(`The tactic comes off ${Math.round(plan.bonuses.chance * 100)}% more often.`);
  if (plan.bonuses.morale > 0) lines.push(`The army starts with +${plan.bonuses.morale} morale.`);
  if (plan.bonuses.supplyFactor < 1) lines.push(`The march consumes ${Math.round((1 - plan.bonuses.supplyFactor) * 100)}% less food.`);
  return lines;
}

function PlanDetail({ plan, council, busy, mutate, onEdit }: { plan: WarPlanDTO; council: WarCouncilResponse; busy: boolean; mutate: Mutate; onEdit: () => void }) {
  const { world, resources } = useGame();
  const [confirm, setConfirm] = useState<'launch' | 'cancel' | null>(null);
  const open = plan.status === 'draft' || plan.status === 'ready';
  const target = council.targets.find((t) => t.id === plan.targetProvinceId);
  const relation = RELATION[target?.relation ?? 'own'];
  const commander = plan.commander ? council.members.find((m) => m.playerId === plan.commander!.playerId) : null;
  const commanderDuty = plan.assignments.find((a) => a.duty === 'commander');
  const yours = plan.assignments.filter((a) => a.isYou && a.status === 'assigned');
  const bonuses = bonusLines(plan);
  const outcome = outcomeLabel(plan.outcome);
  const post = (path: string, body: unknown, success: string) => mutate(() => apiPost<WarCouncilResponse>(`/api/war/plans/${plan.id}/${path}`, body), success);

  return (
    <>
      <section className="panel p-4">
        <div className="flex flex-wrap items-start gap-3">
          <TacticSeal tactic={plan.tactic} size="lg" tone="red" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h2 className="font-display text-xl font-extrabold leading-tight">{plan.title}</h2>
              <span className={STATUS[plan.status].chip}>{STATUS[plan.status].label}</span>
            </div>
            <p className="mt-0.5 text-sm text-muted">
              Drafted {fmtDateTime(plan.createdAt)}
              {plan.createdBy ? ` by ${plan.createdBy}` : ''}
            </p>
          </div>
          {plan.canEdit ? (
            <button type="button" className="btn btn-sm shrink-0" onClick={onEdit}>
              Change plan
            </button>
          ) : null}
        </div>

        <dl className="mt-4 grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[0.66rem] uppercase tracking-wider text-muted">Target</dt>
            <dd className="mt-0.5 flex flex-wrap items-center gap-2">
              <Icon name="target" className="text-gold" />
              <span className="font-display text-base font-bold">{plan.targetName}</span>
              {open ? <span className={relation.chip}>{relation.label}</span> : null}
              <span className="w-full text-xs text-muted">
                {/* Who holds it matters while the plan is open; afterwards the land may have changed hands again. */}
                {open ? (plan.targetOwnerName ? `Held by ${plan.targetOwnerName}` : 'Held by local warriors') : null}
                {open && target ? ' · ' : ''}
                {target ? TERRAIN_INFO[target.terrain].name : ''}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-[0.66rem] uppercase tracking-wider text-muted">Sets out from</dt>
            <dd className="mt-0.5 font-display text-base font-bold">{plan.originName}</dd>
            <dd className="text-xs text-muted">
              {fmt(plan.total)} soldiers
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[0.66rem] uppercase tracking-wider text-muted">The host</dt>
            <dd className="mt-1">
              <UnitsRow units={plan.units} />
            </dd>
          </div>
          <div>
            <dt className="text-[0.66rem] uppercase tracking-wider text-muted">Commander</dt>
            <dd className="mt-0.5">
              {plan.commander ? (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <PlayerLink id={plan.commander.playerId} className="font-display text-base font-bold">
                    {plan.commander.nickname}
                  </PlayerLink>
                  {commander ? <span className="num text-xs text-muted">Military {commander.pillars.military}</span> : null}
                  {commanderDuty ? <DutyStatus status={commanderDuty.status} /> : null}
                </span>
              ) : (
                <span className="text-vermilion-bright">Nobody yet. A plan needs a commander before it is ready.</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[0.66rem] uppercase tracking-wider text-muted">Attack time</dt>
            <dd className="mt-0.5">
              {plan.scheduledAt ? (
                <>
                  <span className="font-bold">{fmtDateTime(plan.scheduledAt)}</span>
                  {open ? (
                    <span className="text-xs text-muted">
                      {' '}
                      · in <Countdown to={plan.scheduledAt} done="now" />
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-muted">When the council gives the word</span>
              )}
            </dd>
          </div>
          {plan.notes ? (
            <div className="sm:col-span-2">
              <dt className="text-[0.66rem] uppercase tracking-wider text-muted">Notes: retreat, backup strategy</dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-parchment/90">{plan.notes}</dd>
            </div>
          ) : null}
        </dl>
        {open && relation.note ? <p className="mt-3 rounded-[3px] border border-vermilion/40 bg-vermilion/10 px-3 py-2 text-sm">{relation.note}</p> : null}
      </section>

      {yours.length > 0 && open ? (
        <section className="panel border-gold/60 bg-gold/10 p-4">
          <h3 className="flex items-center gap-2 font-display text-lg font-bold text-gold-bright">
            <Icon name="announce" /> Your duties
          </h3>
          <ul className="mt-2 space-y-3">
            {yours.map((a) => (
              <li key={a.duty} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="font-display text-base font-bold">{DUTY_DEFS[a.duty].name}</p>
                  <p className="text-sm text-parchment/85">
                    {DUTY_DEFS[a.duty].summary} {DUTY_DEFS[a.duty].effect}
                  </p>
                  {a.note ? <p className="mt-0.5 text-sm italic text-muted">&ldquo;{a.note}&rdquo;</p> : null}
                </div>
                <div className="flex gap-2">
                  <ActionButton variant="gold" size="sm" busy={busy} onClick={() => void post('respond', { duty: a.duty, accept: true }, `You accept the duty of ${DUTY_DEFS[a.duty].name}.`)}>
                    Accept
                  </ActionButton>
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void post('respond', { duty: a.duty, accept: false }, 'You decline the duty.')}>
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Section title="Strategy" icon="tactic">
        <TacticCard option={planOption(plan, world.tickIntervalMs)} selected={false} have={open ? resources : null} />
        {open ? (
          <div className="mt-3">
            <KnownStanceNote known={plan.knownStance ? { stance: plan.knownStance.stance, stanceName: plan.knownStance.stanceName } : null} tactic={plan.tactic} />
          </div>
        ) : null}
        {open ? (
          <p className="mt-3 text-sm text-muted">
            {plan.chance === null
              ? 'A plain assault cannot miscarry, and nothing is gained by it.'
              : `Against a garrison that is not ready for it and no more skilled than you, this comes off about ${chanceLabel(plan.chance)} of the time (duties included).`}
          </p>
        ) : null}
      </Section>

      <Section title="Duties" icon="members">
        {plan.assignments.length === 0 ? (
          <p className="text-sm text-muted">Nobody has a duty yet.</p>
        ) : (
          <ul className="divide-y divide-gold/10">
            {plan.assignments.map((a) => (
              <DutyRow
                key={`${a.playerId}:${a.duty}`}
                assignment={a}
                canRemove={plan.canEdit && a.duty !== 'commander'}
                busy={busy}
                onRemove={() => void post('unassign', { playerId: a.playerId, duty: a.duty }, `${a.nickname} is relieved of the duty.`)}
              />
            ))}
          </ul>
        )}
        <div className="mt-3 rounded-[3px] border border-gold/20 bg-ink-900/60 px-3 py-2.5 text-sm">
          <p className="mb-1 text-[0.66rem] uppercase tracking-wider text-muted">What the accepted duties add</p>
          {bonuses.length > 0 ? (
            <ul className="space-y-0.5">
              {bonuses.map((b) => (
                <li key={b} className="flex items-start gap-2 text-jade">
                  <Icon name="check" className="mt-0.5 shrink-0" /> <span className="text-parchment/90">{b}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Nothing yet. A Strategist, a Scout with a fresh report, a Logistics Officer and Reinforcements each add something once they accept.</p>
          )}
        </div>
        {plan.canEdit ? <AssignForm plan={plan} council={council} busy={busy} onAssign={(body, name) => void post('assign', body, `${name} is given the duty.`)} /> : null}
      </Section>

      <Section title={open ? 'Readiness and launch' : 'Outcome'} icon="military">
        {open ? (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Fact label="March and battle" value={plan.launch.durationMs > 0 ? fmtDuration(plan.launch.durationMs) : '—'} />
              <Fact label="Supplies" value={plan.launch.durationMs > 0 ? `${fmt(plan.launch.supplies)} food` : '—'} warn={plan.launch.supplies > resources.food} />
              <Fact label="Tactic comes off" value={chanceLabel(plan.chance)} />
              <Fact label="Counter" value={TACTIC_DEFS[plan.tactic].counter ? tacticDefeatedBy(plan.tactic).replace('Defeated by ', '').replace('.', '') : 'None'} />
            </dl>
            <div className="mt-4 flex flex-wrap items-start gap-2">
              {plan.canLaunch || plan.status === 'ready' ? (
                <ActionButton
                  variant="primary"
                  busy={busy}
                  reason={plan.canLaunch ? plan.launch.reason : (plan.launch.reason ?? 'Only the commander or an official who may command can launch the plan')}
                  onClick={() => setConfirm('launch')}
                  wrapperClassName="max-w-[18rem]"
                >
                  <Icon name="military" /> Launch the attack
                </ActionButton>
              ) : null}
              {plan.canEdit && plan.status === 'draft' ? (
                <ActionButton
                  variant="gold"
                  busy={busy}
                  reason={plan.commander ? null : 'Name a commander first'}
                  onClick={() => void post('status', { status: 'ready' }, 'The plan is marked ready.')}
                >
                  Mark ready
                </ActionButton>
              ) : null}
              {plan.canEdit && plan.status === 'ready' ? (
                <button type="button" className="btn" disabled={busy} onClick={() => void post('status', { status: 'draft' }, 'The plan is back on the drawing board.')}>
                  Back to draft
                </button>
              ) : null}
              {plan.canEdit ? (
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirm('cancel')}>
                  Cancel plan
                </button>
              ) : null}
            </div>
            {plan.status === 'draft' ? (
              <p className="mt-3 text-sm text-muted">
                {plan.launch.reason && plan.launch.reason !== 'Mark the plan ready first' ? `Before it can go: ${plan.launch.reason}. ` : ''}
                Once the plan is marked ready, its commander or an official who may command launches it.
              </p>
            ) : null}
          </>
        ) : plan.status === 'launched' ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm">
              The army is on the march against <strong>{plan.targetName}</strong>
              {plan.launchedAt ? `, launched ${fmtDateTime(plan.launchedAt)}` : ''}. The battle report will appear here when it has been fought.
            </p>
            <Link href="/game/military" className="btn btn-sm">
              Watch the march
            </Link>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm">
              {plan.status === 'completed' ? (
                <>
                  The battle for <strong>{plan.targetName}</strong> ended in <strong className="text-gold-bright">{outcome ?? 'an unknown result'}</strong>.
                </>
              ) : (
                <>This plan was abandoned{outcome ? `: ${outcome.toLowerCase()}` : ''}.</>
              )}
            </p>
            {plan.battleId ? (
              <Link href={`/game/battles/${plan.battleId}`} className="btn btn-gold btn-sm">
                Read the battle report
              </Link>
            ) : null}
          </div>
        )}
      </Section>

      <Section title="Timeline of the operation" icon="history" defaultOpen={false}>
        <Timeline plan={plan} />
      </Section>

      <ConfirmDialog
        open={confirm === 'launch'}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          const res = await post('launch', {}, `The army marches on ${plan.targetName}.`);
          if (res) setConfirm(null);
        }}
        busy={busy}
        danger
        icon="military"
        title={`Launch "${plan.title}"?`}
        confirmLabel="Give the order"
        blockedReason={plan.launch.reason}
      >
        <p>
          {fmt(plan.total)} soldiers will march from <strong>{plan.originName}</strong> against <strong>{plan.targetName}</strong> under{' '}
          <strong>{plan.commander?.nickname ?? 'their commander'}</strong>, using <strong>{TACTIC_DEFS[plan.tactic].name}</strong>.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>
            The treasury pays {fmt(plan.launch.supplies)} food for supplies
            {Object.entries(TACTIC_DEFS[plan.tactic].cost).length > 0
              ? `, and ${Object.entries(TACTIC_DEFS[plan.tactic].cost)
                  .map(([k, v]) => `${fmt(v)} ${k}`)
                  .join(' and ')} for the tactic`
              : ''}
            .
          </li>
          <li>Once the column has left it cannot be recalled, and the plan can no longer be changed.</li>
        </ul>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'cancel'}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          const res = await post('status', { status: 'cancelled' }, 'The plan is cancelled.');
          if (res) setConfirm(null);
        }}
        busy={busy}
        danger
        icon="cross"
        title={`Cancel "${plan.title}"?`}
        confirmLabel="Cancel the plan"
      >
        <p>The plan and its duties are set aside. Nothing has been spent, and no soldier has moved.</p>
      </ConfirmDialog>
    </>
  );
}

function Fact({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-[0.66rem] uppercase tracking-wider text-muted">{label}</dt>
      <dd className={cx('num font-display text-[1.02rem] font-bold leading-tight', warn && 'text-vermilion-bright')}>{value}</dd>
    </div>
  );
}

function DutyStatus({ status }: { status: WarAssignmentDTO['status'] }) {
  if (status === 'accepted') return <span className="chip chip-jade">Accepted</span>;
  if (status === 'declined') return <span className="chip chip-red">Declined</span>;
  return <span className="chip chip-muted">Waiting for an answer</span>;
}

function DutyRow({ assignment: a, canRemove, busy, onRemove }: { assignment: WarAssignmentDTO; canRemove: boolean; busy: boolean; onRemove: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 first:pt-0 last:pb-0">
      <Portrait id={a.portrait} size={40} className="shrink-0" />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <PlayerLink id={a.playerId} className="font-display text-base font-bold">
            {a.nickname}
          </PlayerLink>
          {a.isYou ? <span className="chip">You</span> : null}
          <span className="text-sm text-gold-bright">{a.dutyName}</span>
        </div>
        <p className="text-xs text-muted">{DUTY_DEFS[a.duty].effect}</p>
        {a.note ? <p className="text-xs italic text-parchment/70">&ldquo;{a.note}&rdquo;</p> : null}
      </div>
      <DutyStatus status={a.status} />
      {canRemove ? (
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onRemove} aria-label={`Relieve ${a.nickname} of the duty of ${a.dutyName}`}>
          Remove
        </button>
      ) : null}
    </li>
  );
}

function AssignForm({ plan, council, busy, onAssign }: { plan: WarPlanDTO; council: WarCouncilResponse; busy: boolean; onAssign: (body: { playerId: string; duty: WarDuty; note: string }, nickname: string) => void }) {
  const duties = WAR_DUTIES.filter((d) => d !== 'commander');
  const [playerId, setPlayerId] = useState('');
  const [duty, setDuty] = useState<WarDuty>('scout');
  const [note, setNote] = useState('');
  const member = council.members.find((m) => m.playerId === playerId);
  const taken = plan.assignments.some((a) => a.playerId === playerId && a.duty === duty);
  return (
    <form
      className="mt-4 border-t border-gold/15 pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!member || taken) return;
        onAssign({ playerId, duty, note }, member.nickname);
        setNote('');
      }}
    >
      <p className="heading-rule mb-2.5">Give a duty</p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wider text-muted">Official</span>
          <select className="field" value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
            <option value="">Choose an official…</option>
            {council.members.map((m) => (
              <option key={m.playerId} value={m.playerId}>
                {m.nickname} — {m.roleName}, level {m.level}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wider text-muted">Duty</span>
          <select className="field" value={duty} onChange={(e) => setDuty(e.target.value as WarDuty)}>
            {duties.map((d) => (
              <option key={d} value={d}>
                {DUTY_DEFS[d].name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-1.5 text-xs text-muted">
        <strong className="text-parchment/90">{DUTY_DEFS[duty].name}:</strong> {DUTY_DEFS[duty].summary} {DUTY_DEFS[duty].effect}
        {member && (duty === 'strategist' || duty === 'scout' || duty === 'spy') ? ` ${member.nickname} has Intelligence ${member.pillars.intelligence}.` : ''}
      </p>
      <div className="mt-2.5 flex flex-wrap items-start gap-2">
        <input className="field min-w-0 flex-1" placeholder="A word of instruction (optional)" maxLength={160} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Instruction for the official" />
        <ActionButton type="submit" variant="gold" busy={busy} disabled={!member} reason={taken ? `${member?.nickname ?? 'They'} already has that duty` : null}>
          Assign
        </ActionButton>
      </div>
    </form>
  );
}

function Timeline({ plan }: { plan: WarPlanDTO }) {
  const active = plan.assignments.filter((a) => a.status !== 'declined');
  const accepted = active.filter((a) => a.status === 'accepted').length;
  const cancelled = plan.status === 'cancelled';
  const reached = (s: WarPlanDTO['status'][]) => s.includes(plan.status);
  const outcome = outcomeLabel(plan.outcome);
  const steps: { title: string; detail: string; done: boolean }[] = [
    { title: 'Drafted', detail: `${fmtDateTime(plan.createdAt)}${plan.createdBy ? ` by ${plan.createdBy}` : ''}`, done: true },
    {
      title: 'Duties accepted',
      detail: active.length === 0 ? 'No duties given yet' : `${accepted} of ${active.length} accepted`,
      done: active.length > 0 && accepted === active.length,
    },
    { title: 'Marked ready', detail: reached(['ready', 'launched', 'completed']) ? 'The council has settled the plan' : 'Waiting for the council', done: reached(['ready', 'launched', 'completed']) },
    { title: 'Launched', detail: plan.launchedAt ? fmtDateTime(plan.launchedAt) : 'Not yet', done: !!plan.launchedAt },
    { title: 'Battle', detail: plan.battleId ? 'Fought' : plan.status === 'launched' ? 'The army is on the march' : 'Not yet', done: !!plan.battleId },
    { title: cancelled ? 'Abandoned' : 'Outcome', detail: outcome ?? 'Not yet', done: plan.status === 'completed' || cancelled },
  ];
  const next = steps.findIndex((s) => !s.done);
  return (
    <ol className="space-y-0">
      {steps.map((s, i) => (
        <li key={s.title} className="relative flex gap-3 pb-4 last:pb-0">
          {i < steps.length - 1 ? <span className={cx('absolute left-[0.7rem] top-6 h-full w-px', s.done ? 'bg-gold/60' : 'bg-gold/15')} aria-hidden /> : null}
          <span
            className={cx(
              'relative z-[1] grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[0.7rem]',
              s.done ? 'border-gold bg-gold text-ink-950' : i === next && !cancelled ? 'border-gold text-gold-bright' : 'border-gold/25 text-faint',
            )}
            aria-hidden
          >
            {s.done ? <Icon name="check" size="0.85em" strokeWidth={2.6} /> : i + 1}
          </span>
          <div className="min-w-0 leading-tight">
            <p className={cx('font-display text-[0.98rem] font-bold', !s.done && i !== next && 'text-muted')}>{s.title}</p>
            <p className="text-xs text-muted">{s.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Drafting and changing a plan
// ---------------------------------------------------------------------------

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function PlanEditor({
  council,
  plan,
  busy,
  onCancel,
  onSave,
}: {
  council: WarCouncilResponse;
  plan: WarPlanDTO | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (body: WarPlanRequest, planId: string | null) => Promise<void>;
}) {
  const { world, resources, player } = useGame();
  const now = useNow();
  const [title, setTitle] = useState(plan?.title ?? '');
  const [targetId, setTargetId] = useState(plan?.targetProvinceId ?? '');
  const [originId, setOriginId] = useState(plan?.originProvinceId ?? council.origins[0]?.id ?? '');
  const [units, setUnits] = useState<UnitCounts>(plan ? { ...emptyUnits(), ...plan.units } : emptyUnits());
  const [tactic, setTactic] = useState<TacticId>(plan?.tactic ?? 'assault');
  const [commanderId, setCommanderId] = useState(plan?.commander?.playerId ?? '');
  const [when, setWhen] = useState(toLocalInput(plan?.scheduledAt ?? null));
  const [notes, setNotes] = useState(plan?.notes ?? '');
  const filled = useRef<string | null>(plan ? plan.originProvinceId : null);

  const origin = council.origins.find((o) => o.id === originId);
  const target = council.targets.find((t) => t.id === targetId);
  const available = useMemo<UnitCounts>(() => origin?.garrison ?? emptyUnits(), [origin]);
  const commander = council.members.find((m) => m.playerId === commanderId);

  // A new origin starts with its whole garrison chosen; the host can never exceed what is stationed there.
  useEffect(() => {
    if (!origin) return;
    if (filled.current !== origin.id) {
      filled.current = origin.id;
      setUnits({ ...origin.garrison });
      return;
    }
    setUnits((u) => {
      const next = { ...u };
      let changed = false;
      for (const t of UNIT_TYPES) {
        if (next[t] > available[t]) {
          next[t] = available[t];
          changed = true;
        }
      }
      return changed ? next : u;
    });
  }, [origin, available]);

  const total = totalUnits(units);

  // The server's view of the march, and what the scouts know of the target.
  const request = useMemo(() => (originId && targetId && total > 0 ? { fromProvinceId: originId, toProvinceId: targetId, units } : null), [originId, targetId, units, total]);
  const debounced = useDebounced(request, 300);
  const [preview, setPreview] = useState<MarchPreviewResponse | null>(null);
  useEffect(() => {
    if (!debounced) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    apiPost<MarchPreviewResponse>('/api/army/preview', debounced)
      .then((res) => {
        if (!cancelled) setPreview(res);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);
  const known: KnownStance | null = preview?.knownStance ?? null;

  // The army fights with its commander's own Military pillar.
  const levels = useMemo(() => ({ ...council.levels, ...(commander ? { military: commander.pillars.military } : {}) }), [council.levels, commander]);
  const options = useMemo<TacticOptionDTO[]>(
    () =>
      TACTICS.map((id) => {
        const def = TACTIC_DEFS[id];
        return {
          id,
          blockedReason: tacticBlockReason(id, units, levels, target?.terrain ?? null),
          chance: def.baseChance >= 1 ? null : tacticChance({ tactic: id, attackerLevels: levels, defenderLevels: levels, chanceBonus: 0 }),
          cost: def.cost,
          extraMs: (def.extraMinutes * world.tickIntervalMs) / 60,
          supplyFactor: def.supplyFactor,
          counteredByKnownStance: !!known && def.counter === known.stance,
        };
      }),
    [units, levels, target, known, world.tickIntervalMs],
  );
  const chosen = options.find((o) => o.id === tactic);

  const scheduled = when ? new Date(when) : null;
  let blocked: string | null = null;
  if (title.trim().length < 3) blocked = 'Give the plan a name';
  else if (!targetId) blocked = 'Choose a target';
  else if (!originId) blocked = 'Choose where the army sets out from';
  else if (total <= 0) blocked = 'Choose the soldiers to send';
  else if (scheduled && Number.isNaN(scheduled.getTime())) blocked = 'The attack time is not a valid date';

  const save = () =>
    onSave(
      {
        title: title.trim(),
        targetProvinceId: targetId,
        originProvinceId: originId,
        tactic,
        units,
        commanderId: commanderId || null,
        scheduledAt: scheduled && !Number.isNaN(scheduled.getTime()) ? scheduled.toISOString() : null,
        notes,
      },
      plan?.id ?? null,
    );

  const relation = target ? RELATION[target.relation] : null;
  const grouped = (['enemy', 'unclaimed', 'foreign', 'allied'] as const).map((r) => ({ relation: r, items: council.targets.filter((t) => t.relation === r) })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4 lg:space-y-5">
      <Panel title={plan ? `Change "${plan.title}"` : 'Draft a war plan'} icon="war">
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-muted">Name of the plan</span>
            <input className="field" value={title} maxLength={60} placeholder="e.g. The road to the capital" onChange={(e) => setTitle(e.target.value)} />
          </label>

          <div>
            <p className="heading-rule mb-2.5">Target</p>
            {council.targets.length === 0 ? (
              <p className="text-sm text-muted">There is no province left to take.</p>
            ) : (
              <div className="max-h-[17rem] space-y-3 overflow-y-auto pr-1">
                {grouped.map((g) => (
                  <div key={g.relation}>
                    <p className="mb-1.5 text-[0.66rem] uppercase tracking-wider text-muted">{RELATION[g.relation].label}</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {g.items.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setTargetId(t.id)}
                          aria-pressed={t.id === targetId}
                          className={cx('panel-flat flex min-h-[52px] items-center gap-2.5 px-3 py-2 text-left transition-colors', t.id === targetId ? '!border-gold/70 bg-gold/10' : 'hover:border-gold/40')}
                        >
                          <Icon name="target" className={t.id === targetId ? 'text-gold-bright' : 'text-muted'} />
                          <span className="min-w-0 flex-1 leading-tight">
                            <span className="block truncate font-display font-bold">{t.name}</span>
                            <span className="block truncate text-xs text-muted">
                              {t.ownerName ?? 'Local warriors'} · {TERRAIN_INFO[t.terrain].name}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {relation?.note ? <p className="mt-2 text-sm text-vermilion-bright">{relation.note}</p> : null}
            {target ? <KnownStanceNote known={known} tactic={tactic} className="mt-2.5" /> : null}
          </div>

          <div>
            <p className="heading-rule mb-2.5">The host</p>
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wider text-muted">Sets out from</span>
              <select className="field" value={originId} onChange={(e) => setOriginId(e.target.value)}>
                {council.origins.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} — {fmt(totalUnits(o.garrison))} soldiers
                  </option>
                ))}
              </select>
            </label>
            {totalUnits(available) === 0 ? (
              <p className="mt-2 text-sm text-vermilion-bright">No soldiers are stationed there. Recruit at a Barracks, or choose another province.</p>
            ) : (
              <ul className="mt-2.5 space-y-2.5">
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
            )}
            {preview && total > 0 ? (
              <p className="mt-2 text-sm text-muted">
                {preview.durationMs > 0 ? `About ${fmtDuration(preview.durationMs)} on the road, ${fmt(Math.ceil(preview.supplies * (chosen?.supplyFactor ?? 1)))} food in supplies.` : ''}
                {!preview.ok && preview.reason ? <span className="text-vermilion-bright"> {preview.reason}</span> : null}
              </p>
            ) : null}
          </div>

          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-muted">Commander</span>
            <select className="field" value={commanderId} onChange={(e) => setCommanderId(e.target.value)}>
              <option value="">Decide later…</option>
              {[...council.members]
                .sort((a, b) => b.pillars.military - a.pillars.military)
                .map((m) => (
                  <option key={m.playerId} value={m.playerId}>
                    {m.nickname}
                    {m.playerId === player.id ? ' (you)' : ''} — {m.roleName} · Military {m.pillars.military}
                  </option>
                ))}
            </select>
            <span className="mt-1 block text-xs text-muted">The army fights with the commander&apos;s own Military pillar, whatever their office.</span>
          </label>
        </div>
      </Panel>

      <Panel title="Tactic" icon="tactic">
        <TacticPicker options={options} value={tactic} onChange={setTactic} have={resources} />
        {chosen?.blockedReason ? <p className="mt-2.5 text-sm text-vermilion-bright">You can keep this tactic in the draft, but the plan cannot be launched with it: {chosen.blockedReason}.</p> : null}
      </Panel>

      <Panel title="Timing and notes" icon="clock">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-muted">Attack time (optional)</span>
            <input type="datetime-local" className="field" value={when} min={toLocalInput(new Date(now).toISOString())} onChange={(e) => setWhen(e.target.value)} />
            <span className="mt-1 block text-xs text-muted">For coordination. The attack still begins when someone launches it.</span>
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs uppercase tracking-wider text-muted">Notes: when to retreat, the backup strategy</span>
            <textarea className="field min-h-[5.5rem]" maxLength={600} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. If their walls hold after the first assault, fall back and lay a siege." />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-start justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Discard
          </button>
          <ActionButton variant="gold" busy={busy} reason={blocked} onClick={() => void save()}>
            {plan ? 'Save changes' : 'Put it on the table'}
          </ActionButton>
        </div>
      </Panel>
    </div>
  );
}
