'use client';

/**
 * Government: everything about the nation the player serves — its cabinet and
 * announcement, its officials and their roles, the National Treasury, the nation's
 * settings and permissions, and its history.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import type { ClanHubResponse, ClanMemberDTO, MeResponse, TreasuryEntryDTO } from '@/game/api';
import {
  CLAN_LANGUAGES,
  CLAN_PERMISSIONS,
  CLAN_ROLES,
  CLAN_RULES,
  CONFIGURABLE_ROLES,
  PERMISSION_DEFS,
  RECRUITMENT_DEFS,
  RECRUITMENT_MODES,
  ROLE_DEFS,
  SEAT_OF_PILLAR,
  outranks,
  type ClanPermission,
  type ClanRole,
  type RecruitmentMode,
} from '@/game/clan';
import { RESOURCE_INFO, RESOURCE_KEYS, type ResourceKey } from '@/game/config';
import { PILLARS, PILLAR_DEFS } from '@/game/pillars';
import { Banner } from '@/components/Banner';
import {
  ClanTag,
  EmptyList,
  FallenClanState,
  NoClanState,
  PlayerLink,
  RecruitmentChip,
  ResourceInputs,
  RoleBadge,
  amountTotal,
  emptyAmounts,
  type AmountBag,
} from '@/components/clan';
import { DoctrinePanel } from '@/components/DoctrinePanel';
import { Icon, type IconName } from '@/components/icons';
import { Portrait } from '@/components/Portrait';
import { ActionButton, ConfirmDialog, Dialog, ErrorState, LoadingState, PageHeader, Panel, Stat, Tabs } from '@/components/ui';
import { ApiError, apiPost } from '@/lib/api';
import { useNow } from '@/lib/clock';
import { EVENTS } from '@/lib/events';
import { cx, fmt, fmtCompact, fmtDateTime, fmtSigned, timeAgo } from '@/lib/format';
import { useSession } from '@/lib/game-context';
import { useAction, useApi, type ApiState } from '@/lib/hooks';

type Tab = 'overview' | 'members' | 'treasury' | 'settings' | 'history';
const TABS: Tab[] = ['overview', 'members', 'treasury', 'settings', 'history'];

export default function ClanPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ClanScreen />
    </Suspense>
  );
}

function ClanScreen() {
  const session = useSession();
  if (!session.clan) return <NoClanState what="You serve no nation yet." />;
  return <ClanHub />;
}

type HubState = ApiState<ClanHubResponse>;

/** Run a nation mutation that answers with the refreshed hub. */
function useHubMutation(state: HubState) {
  const action = useAction();
  const mutate = (path: string, body: unknown, success: string) =>
    action.run(
      async () => {
        const res = await apiPost<ClanHubResponse>(path, body);
        state.setData(res);
        return res;
      },
      { success },
    );
  return { mutate, busy: action.busy };
}

function ClanHub() {
  const router = useRouter();
  const params = useSearchParams();
  const session = useSession();
  const state = useApi<ClanHubResponse>('/api/clan', EVENTS.clan);
  const requested = params.get('tab') as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : 'overview';
  const setTab = (next: Tab) => router.replace(next === 'overview' ? '/game/clan' : `/game/clan?tab=${next}`, { scroll: false });

  // Removed from the nation (or it was dissolved) while this screen was open: catch up with the session at once.
  const lost = state.error instanceof ApiError && state.error.code === 'NO_CLAN';
  const refreshMe = session.refreshMe;
  useEffect(() => {
    if (lost) void refreshMe();
  }, [lost, refreshMe]);

  if (state.error && !state.data) return <ErrorState message={state.error.message} onRetry={() => void state.refresh()} />;
  if (!state.data) return <LoadingState label="Opening the government register…" />;
  const hub = state.data;
  const { clan, membership } = hub;

  return (
    <div>
      <PageHeader
        icon="clan"
        title={`Government of ${clan.name}`}
        subtitle={
          <>
            <ClanTag tag={clan.tag} /> · {hub.fallen ? 'fallen' : `rank ${clan.rank}`} · {clan.memberCount} of {hub.maxMembers} officials · you are {membership.roleName}
          </>
        }
        action={
          <Link href="/game/clans" className="btn btn-sm shrink-0">
            All nations
          </Link>
        }
      />
      {hub.fallen ? (
        <div className="mb-4">
          <FallenClanState />
        </div>
      ) : null}
      <Tabs<Tab>
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'members', label: 'Officials', badge: hub.applications.length || null },
          { id: 'treasury', label: 'Treasury' },
          { id: 'settings', label: 'Settings' },
          { id: 'history', label: 'History' },
        ]}
      />
      {tab === 'overview' ? <Overview hub={hub} state={state} onLeft={() => void session.refreshMe()} /> : null}
      {tab === 'members' ? <Members hub={hub} state={state} /> : null}
      {tab === 'treasury' ? <Treasury hub={hub} state={state} /> : null}
      {tab === 'settings' ? <Settings hub={hub} state={state} /> : null}
      {tab === 'history' ? <History hub={hub} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function Overview({ hub, state, onLeft }: { hub: ClanHubResponse; state: HubState; onLeft: () => void }) {
  const { clan, membership } = hub;
  const router = useRouter();
  const session = useSession();
  const { mutate, busy } = useHubMutation(state);
  const leave = useAction();
  const now = useNow();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(hub.announcement?.body ?? '');
  const [leaving, setLeaving] = useState(false);
  const canAnnounce = session.can('manage_clan');
  const isLeader = membership.role === 'leader';
  const alone = hub.members.length <= 1;
  const me = hub.members.find((m) => m.isYou);

  const saveAnnouncement = async (body: string) => {
    const res = await mutate('/api/clan/announcement', { body }, body.trim() ? 'The announcement is posted.' : 'The announcement is cleared.');
    if (res) setEditing(false);
  };

  const doLeave = async () => {
    const res = await leave.run(() => apiPost<MeResponse>('/api/clan/leave'), {
      success: isLeader ? `${clan.name} is dissolved.` : `You have left ${clan.name}.`,
    });
    if (res) {
      setLeaving(false);
      onLeft();
      router.replace('/game/clans');
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-5">
      <div className="space-y-4 lg:space-y-5">
        <Panel
          title="Announcement"
          icon="announce"
          action={
            canAnnounce && !editing ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setDraft(hub.announcement?.body ?? '');
                  setEditing(true);
                }}
              >
                {hub.announcement ? 'Edit' : 'Write'}
              </button>
            ) : undefined
          }
        >
          {editing ? (
            <div>
              <label className="sr-only" htmlFor="announcement">
                Announcement to the nation
              </label>
              <textarea id="announcement" className="field min-h-[110px]" maxLength={CLAN_RULES.announcementMax} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Orders and news for every official…" />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="num text-[0.68rem] text-faint">
                  {draft.length} / {CLAN_RULES.announcementMax}
                </span>
                <span className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)} disabled={busy}>
                    Cancel
                  </button>
                  {hub.announcement ? (
                    <button type="button" className="btn btn-sm" onClick={() => void saveAnnouncement('')} disabled={busy}>
                      Clear
                    </button>
                  ) : null}
                  <ActionButton variant="gold" size="sm" busy={busy} disabled={!draft.trim()} onClick={() => void saveAnnouncement(draft)}>
                    Post
                  </ActionButton>
                </span>
              </div>
            </div>
          ) : hub.announcement ? (
            <div>
              <p className="whitespace-pre-wrap break-words border-l-2 border-gold/50 pl-3 font-display text-[1.02rem] leading-relaxed">{hub.announcement.body}</p>
              <p className="mt-2 text-xs text-muted">
                {hub.announcement.by ? `Posted by ${hub.announcement.by}` : 'Posted'} · {now ? timeAgo(hub.announcement.at, now) : fmtDateTime(hub.announcement.at)}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted">No announcement. {canAnnounce ? 'Write one to give the nation its orders.' : 'The government can post orders and news here.'}</p>
          )}
        </Panel>

        <Panel title="The nation" icon="clan">
          <div className="flex items-start gap-4">
            <Banner color={clan.banner.color} mon={clan.banner.mon} size={84} title={`Flag of ${clan.name}`} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-xl font-extrabold leading-tight">
                  {clan.name} <ClanTag tag={clan.tag} />
                </h2>
                <RecruitmentChip clan={clan} />
              </div>
              <p className="mt-0.5 text-sm text-muted">
                Led by {clan.playerNickname ?? clan.daimyoName} · {CLAN_LANGUAGES.find((l) => l.id === clan.language)?.name ?? 'Any language'}
              </p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-parchment/90">{clan.description || 'No description yet.'}</p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-gold/15 pt-3 sm:grid-cols-5">
            <Stat label="Rank" value={hub.fallen ? '—' : `#${clan.rank}`} hint={`${fmt(clan.score)} renown`} />
            <Stat label="War record" value={`${clan.victories} – ${clan.defeats}`} hint="battles won – lost" />
            <Stat label="Provinces" value={clan.provinceCount} hint={`${fmtCompact(clan.population)} people`} />
            <Stat label="Officials" value={`${clan.memberCount} / ${hub.maxMembers}`} />
            <Stat label="Army" value={fmtCompact(clan.army.total)} hint={`of ${fmtCompact(clan.army.capacity)}`} />
          </dl>
        </Panel>

        <Council members={hub.members} />

        <DoctrinePanel hub={hub} onChanged={(res) => state.setData(res)} />
      </div>

      <div className="space-y-4 lg:space-y-5">
        <Panel title="Your place" icon="user">
          <div className="flex items-center gap-3">
            <Portrait id={session.player.portrait} accent={clan.banner.color} size={56} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate font-display text-lg font-bold">{session.player.nickname}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <RoleBadge role={membership.role} />
                <span className="text-xs text-muted">joined {fmtDateTime(membership.joinedAt)}</span>
              </div>
            </div>
          </div>
          <p className="mt-3 text-sm text-parchment/85">{ROLE_DEFS[membership.role].summary}</p>
          <div className="mt-3">
            <div className="heading-rule mb-2">What you may do</div>
            {membership.permissions.length === 0 ? (
              <p className="text-sm text-muted">Contribute to the National Treasury, speak in the nation channel and grow your own pillars. The {ROLE_DEFS.leader.name} decides what each role may do beyond that.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {membership.permissions.map((p) => (
                  <li key={p} className="chip" title={PERMISSION_DEFS[p].summary}>
                    {PERMISSION_DEFS[p].name}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-gold/15 pt-3">
            <Stat label="Your contribution" value={fmt(me?.contribution ?? 0)} hint="points paid in" />
            <Stat label="Your level" value={me?.level ?? session.personal.level} />
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/game/clan?tab=treasury" className="btn btn-sm btn-gold">
              Contribute
            </Link>
            <Link href="/game/messages?channel=clan" className="btn btn-sm">
              Nation channel
            </Link>
          </div>
        </Panel>

        <Panel title="Leave the nation" icon="leave">
          <p className="text-sm text-muted">
            {isLeader
              ? alone
                ? 'You are the last official. Leaving dissolves the nation: its land returns to the local militia and its name becomes free.'
                : 'Whoever leads cannot simply walk away. Hand the leadership to another official first (Officials tab).'
              : 'You keep your purse and everything you have learned in the Five Pillars. What you paid into the National Treasury stays with the nation.'}
          </p>
          <ActionButton className="mt-3" variant="primary" size="sm" reason={isLeader && !alone ? 'Hand over the leadership first' : null} onClick={() => setLeaving(true)}>
            {isLeader && alone ? 'Dissolve the nation' : 'Leave the nation'}
          </ActionButton>
        </Panel>
      </div>

      <ConfirmDialog
        open={leaving}
        onClose={() => setLeaving(false)}
        onConfirm={() => void doLeave()}
        busy={leave.busy}
        danger
        icon="leave"
        title={isLeader ? `Dissolve ${clan.name}?` : `Leave ${clan.name}?`}
        confirmLabel={isLeader ? 'Dissolve the nation' : 'Leave the nation'}
      >
        {isLeader ? (
          <p>The nation will cease to exist. Its provinces go back to the local militia, its armies disband and its treasury is lost. This cannot be undone.</p>
        ) : (
          <p>You will lose your role and your access to the nation&apos;s land, armies, treasury and channel. You can join another nation or found your own at once.</p>
        )}
      </ConfirmDialog>
    </div>
  );
}

/** Who carries each pillar for the whole nation. */
function Council({ members }: { members: ClanMemberDTO[] }) {
  return (
    <Panel title="Cabinet" icon="pillars">
      <p className="mb-3 text-sm text-muted">
        Each pillar of the nation is carried by one official: the stronger of the {ROLE_DEFS.leader.name} and whoever holds that pillar&apos;s seat in the cabinet. A government of specialists is stronger than one person trying to master everything.
      </p>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        {PILLARS.map((p) => {
          const holder = members.find((m) => m.carries.includes(p));
          const seat = ROLE_DEFS[SEAT_OF_PILLAR[p]];
          const seated = holder ? holder.role === seat.id : false;
          // The seat may be filled by someone the head of government still outshines in this pillar.
          const occupants = members.filter((m) => m.role === seat.id);
          return (
            <li key={p} className="panel-flat flex items-center gap-3 px-3 py-2.5">
              <span className="seal seal-sm" aria-hidden>
                <Icon name={p} />
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="font-display text-[0.98rem] font-bold">{PILLAR_DEFS[p].name}</div>
                <div className="text-xs leading-snug text-muted">
                  Seat: {seat.name}
                  {holder && !seated && seat.id !== 'leader'
                    ? occupants.length === 0
                      ? ` — empty, the ${ROLE_DEFS.leader.name} stands in`
                      : ` — held by ${occupants.map((m) => m.nickname).join(', ')}, but the ${ROLE_DEFS.leader.name} is stronger`
                    : ''}
                </div>
              </div>
              <div className="text-right leading-tight">
                {holder ? (
                  <>
                    <PlayerLink id={holder.playerId} className="block max-w-[8.5rem] truncate text-sm font-bold">
                      {holder.nickname}
                      {holder.isYou ? ' (you)' : ''}
                    </PlayerLink>
                    <span className="num text-xs text-gold">Lv {holder.pillars[p]}</span>
                  </>
                ) : (
                  <span className="text-xs text-muted">nobody</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

function Members({ hub, state }: { hub: ClanHubResponse; state: HubState }) {
  const session = useSession();
  const { mutate, busy } = useHubMutation(state);
  const [managing, setManaging] = useState<ClanMemberDTO | null>(null);
  const [nickname, setNickname] = useState('');
  const canManage = session.can('manage_members');
  const isLeader = hub.membership.role === 'leader';
  const full = hub.members.length >= hub.maxMembers;

  const invite = async () => {
    const name = nickname.trim();
    if (!name) return;
    const res = await mutate('/api/clan/invitations', { nickname: name }, `An invitation is on its way to ${name}.`);
    if (res) setNickname('');
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-5">
      <Panel title={`Officials · ${hub.members.length} of ${hub.maxMembers}`} icon="members" bodyClassName="p-0">
        <ul className="divide-y divide-gold/10">
          {hub.members.map((m) => (
            <li key={m.playerId} className={cx('flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3 sm:px-4', m.isYou && 'bg-gold/8')}>
              <Portrait id={m.portrait} accent={hub.clan.banner.color} size={46} className="shrink-0" />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <PlayerLink id={m.playerId} className="truncate font-display text-base font-bold">
                    {m.nickname}
                  </PlayerLink>
                  {m.isYou ? <span className="chip">You</span> : null}
                  <RoleBadge role={m.role} />
                </div>
                <div className="num mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                  <span>Level {m.level}</span>
                  <span>{fmt(m.contribution)} contributed</span>
                  {m.carries.length > 0 ? (
                    <span className="inline-flex items-center gap-1 text-gold" title={`Carries ${m.carries.map((p) => PILLAR_DEFS[p].name).join(', ')} for the nation`}>
                      carries
                      {m.carries.map((p) => (
                        <Icon key={p} name={p} />
                      ))}
                      <span className="sr-only">{m.carries.map((p) => PILLAR_DEFS[p].name).join(', ')}</span>
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!m.isYou ? (
                  <Link href={`/game/messages?with=${m.playerId}`} className="btn btn-sm btn-ghost" aria-label={`Message ${m.nickname}`} title={`Message ${m.nickname}`}>
                    <Icon name="mail" />
                  </Link>
                ) : null}
                {m.canManage || (isLeader && !m.isYou) ? (
                  <button type="button" className="btn btn-sm" onClick={() => setManaging(m)}>
                    Manage
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="space-y-4 lg:space-y-5">
        {canManage ? (
          <Panel title="Applications" icon="scroll" action={hub.applications.length ? <span className="chip chip-red">{hub.applications.length}</span> : undefined} bodyClassName="p-0">
            {hub.applications.length === 0 ? (
              <EmptyList title="No applications waiting">Players who ask to join appear here.</EmptyList>
            ) : (
              <ul className="divide-y divide-gold/10">
                {hub.applications.map((a) => (
                  <li key={a.id} className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Portrait id={a.player.portrait} size={40} className="shrink-0" />
                      <div className="min-w-0 flex-1 leading-tight">
                        <PlayerLink id={a.player.playerId} className="block truncate font-display font-bold">
                          {a.player.nickname}
                        </PlayerLink>
                        <div className="num text-xs text-muted">Level {a.player.level}</div>
                      </div>
                    </div>
                    {a.message ? <p className="mt-2 break-words border-l-2 border-gold/40 pl-3 text-sm italic text-parchment/85">{a.message}</p> : null}
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <ActionButton
                        variant="gold"
                        size="sm"
                        busy={busy}
                        reason={full ? 'The nation is full' : null}
                        onClick={() => void mutate('/api/clan/applications', { applicationId: a.id, accept: true }, `${a.player.nickname} joins the nation as ${ROLE_DEFS.recruit.name}.`)}
                      >
                        Accept
                      </ActionButton>
                      <ActionButton size="sm" busy={busy} onClick={() => void mutate('/api/clan/applications', { applicationId: a.id, accept: false }, `${a.player.nickname}'s application is declined.`)}>
                        Decline
                      </ActionButton>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}

        <Panel title="Invite a player" icon="mail">
          {canManage ? (
            <form
              className="flex items-start gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void invite();
              }}
            >
              <label className="sr-only" htmlFor="invite-nickname">
                Nickname of the player to invite
              </label>
              <input id="invite-nickname" className="field min-w-0 flex-1" value={nickname} maxLength={40} onChange={(e) => setNickname(e.target.value)} placeholder="Player nickname" autoComplete="off" />
              <ActionButton variant="gold" type="submit" busy={busy} reason={full ? 'Full' : null} disabled={!nickname.trim()}>
                Invite
              </ActionButton>
            </form>
          ) : (
            <p className="text-sm text-muted">{session.lacks('manage_members')}.</p>
          )}
          {hub.invitations.length > 0 ? (
            <ul className="mt-3 divide-y divide-gold/10 border-t border-gold/15">
              {hub.invitations.map((i) => (
                <li key={i.id} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1 leading-tight">
                    <PlayerLink id={i.playerId} className="block truncate text-sm font-bold">
                      {i.nickname}
                    </PlayerLink>
                    <span className="text-xs text-muted">invited{i.invitedBy ? ` by ${i.invitedBy}` : ''} · waiting</span>
                  </div>
                  {canManage ? (
                    <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void mutate('/api/clan/invitations/revoke', { invitationId: i.id }, `The invitation to ${i.nickname} is withdrawn.`)}>
                      Revoke
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-muted">No invitations are waiting for an answer.</p>
          )}
        </Panel>
      </div>

      {managing ? <ManageMember hub={hub} state={state} member={hub.members.find((m) => m.playerId === managing.playerId) ?? managing} onClose={() => setManaging(null)} /> : null}
    </div>
  );
}

function ManageMember({ hub, state, member, onClose }: { hub: ClanHubResponse; state: HubState; member: ClanMemberDTO; onClose: () => void }) {
  const { mutate, busy } = useHubMutation(state);
  const session = useSession();
  const myRole = hub.membership.role;
  const isLeader = myRole === 'leader';
  const [confirm, setConfirm] = useState<'kick' | 'transfer' | null>(null);
  const roles = CLAN_ROLES.filter((r) => r !== 'leader' && outranks(myRole, r));
  const canChange = member.canManage;

  const setRole = async (role: ClanRole) => {
    if (role === member.role) return;
    await mutate('/api/clan/members/role', { playerId: member.playerId, role }, `${member.nickname} is now ${ROLE_DEFS[role].name}.`);
  };
  const kick = async () => {
    const res = await mutate('/api/clan/members/kick', { playerId: member.playerId }, `${member.nickname} is removed from the nation.`);
    if (res) onClose();
  };
  const transfer = async () => {
    const res = await mutate('/api/clan/members/transfer', { playerId: member.playerId }, `${member.nickname} now leads the nation.`);
    if (res) {
      await session.refreshMe();
      onClose();
    }
  };

  return (
    <>
      <Dialog
        open={confirm === null}
        onClose={onClose}
        title={`Manage ${member.nickname}`}
        icon="members"
        footer={
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        }
      >
        <div className="flex items-center gap-3">
          <Portrait id={member.portrait} accent={hub.clan.banner.color} size={48} />
          <div className="leading-tight">
            <div className="font-display text-lg font-bold">{member.nickname}</div>
            <div className="mt-1 flex items-center gap-2">
              <RoleBadge role={member.role} />
              <span className="num text-xs text-muted">Level {member.level}</span>
            </div>
          </div>
        </div>

        {canChange ? (
          <fieldset className="mt-4">
            <legend className="heading-rule mb-2 w-full">Role</legend>
            <div className="space-y-1.5" role="radiogroup" aria-label={`Role of ${member.nickname}`}>
              {roles.map((r) => {
                const active = member.role === r;
                return (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={busy}
                    onClick={() => void setRole(r)}
                    className={cx('flex w-full items-start gap-3 rounded-[3px] border px-3 py-2 text-left transition-colors', active ? 'border-gold bg-gold/12' : 'border-gold/15 hover:border-gold/50')}
                  >
                    <span className={cx('mt-1 h-3.5 w-3.5 shrink-0 rounded-full border', active ? 'border-gold bg-gold' : 'border-gold/50')} aria-hidden />
                    <span className="min-w-0 leading-snug">
                      <span className="block font-display font-bold">
                        {ROLE_DEFS[r].name}
                        {ROLE_DEFS[r].seat ? <span className="ml-2 text-xs font-normal text-gold">carries {PILLAR_DEFS[ROLE_DEFS[r].seat!].name}</span> : null}
                      </span>
                      <span className="block text-xs text-muted">{ROLE_DEFS[r].summary}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : (
          <p className="mt-4 text-sm text-muted">You cannot change the role of {ROLE_DEFS[member.role].name}: you may only manage officials below your own rank.</p>
        )}

        <div className="mt-4 flex flex-wrap gap-2 border-t border-gold/15 pt-3">
          {canChange ? (
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => setConfirm('kick')}>
              Remove from the nation
            </button>
          ) : null}
          {isLeader ? (
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setConfirm('transfer')}>
              Hand over leadership
            </button>
          ) : null}
        </div>
      </Dialog>

      <ConfirmDialog open={confirm === 'kick'} onClose={() => setConfirm(null)} onConfirm={() => void kick()} busy={busy} danger icon="leave" title={`Remove ${member.nickname}?`} confirmLabel="Remove from the nation">
        <p>
          {member.nickname} loses their role and their access to the nation. They keep their purse and what they have learned, and may join another nation.
        </p>
      </ConfirmDialog>
      <ConfirmDialog open={confirm === 'transfer'} onClose={() => setConfirm(null)} onConfirm={() => void transfer()} busy={busy} icon="crown" title={`Hand the nation to ${member.nickname}?`} confirmLabel="Hand over leadership">
        <p>
          {member.nickname} becomes {ROLE_DEFS.leader.name} with full control of the nation. You stay on as {ROLE_DEFS.officer.name}. Only the new leader can give the nation back.
        </p>
      </ConfirmDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Treasury
// ---------------------------------------------------------------------------

const REASON_LABEL: Record<string, string> = {
  member_contribution: 'Contribution',
  treasury_withdrawal: 'Paid out to an official',
  building_upgrade: 'Construction',
  recruitment: 'Recruitment',
  festival: 'Festival',
  espionage: 'Scouting',
  march_supplies: 'March supplies',
  war_declaration: 'War declaration',
  battle_loot: 'Battle loot',
  battle_plunder: 'Plundered by the enemy',
  merchant_caravan: 'Merchant caravan',
  founding_grant: 'Founding grant',
  refounding_grant: 'New seat',
};
const reasonLabel = (reason: string) => REASON_LABEL[reason] ?? reason.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function Treasury({ hub, state }: { hub: ClanHubResponse; state: HubState }) {
  const session = useSession();
  const { mutate, busy } = useHubMutation(state);
  const now = useNow();
  const treasury = session.resources ?? hub.clan.resources;
  const purse = session.purse;
  const net = hub.clan.income.net;
  const [give, setGive] = useState<AmountBag>(emptyAmounts());
  const [pay, setPay] = useState<AmountBag>(emptyAmounts());
  const [payee, setPayee] = useState<string>('');
  const [note, setNote] = useState('');
  const canPay = session.can('treasury');

  const overPurse = RESOURCE_KEYS.some((k) => give[k] > purse[k]);
  const giveReason = amountTotal(give) <= 0 ? 'Enter an amount' : overPurse ? 'More than your purse holds' : null;
  const overTreasury = RESOURCE_KEYS.some((k) => pay[k] > treasury[k]);
  const payReason = !payee ? 'Choose an official' : amountTotal(pay) <= 0 ? 'Enter an amount' : overTreasury ? 'More than the treasury holds' : null;

  const contribute = async () => {
    const res = await mutate('/api/clan/contribute', { resources: give }, 'Your contribution is in the National Treasury.');
    if (res) setGive(emptyAmounts());
  };
  const payOut = async () => {
    const name = hub.members.find((m) => m.playerId === payee)?.nickname ?? 'the official';
    const res = await mutate('/api/clan/withdraw', { playerId: payee, resources: pay, note: note.trim() }, `Paid out to ${name}.`);
    if (res) {
      setPay(emptyAmounts());
      setNote('');
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-5">
      <div className="space-y-4 lg:space-y-5">
        <Panel title="National Treasury" icon="treasury">
          <p className="mb-3 text-sm text-muted">Held by the nation and spent on buildings, soldiers, scouts and wars by the officials whose role allows it.</p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-3 2xl:grid-cols-5">
            {RESOURCE_KEYS.map((k) => (
              <li key={k} className="panel-flat px-2.5 py-2 text-center leading-tight">
                <span className="mx-auto mb-1 flex items-center justify-center gap-1.5 text-[0.62rem] uppercase tracking-wider text-muted">
                  <span className="text-gold" aria-hidden>
                    <Icon name={k} />
                  </span>
                  {RESOURCE_INFO[k].name}
                </span>
                <span className="num block font-display text-lg font-bold">{fmt(treasury[k])}</span>
                <span className={cx('num block text-[0.68rem]', net[k] < 0 ? 'text-vermilion-bright' : 'text-muted')}>{fmtSigned(net[k])}/h</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Contribute from your purse" icon="purse">
          <p className="mb-3 text-sm text-muted">
            What you pay in becomes the nation&apos;s. It raises your contribution and your Economy pillar. Your purse: <PurseLine />
          </p>
          <ResourceInputs value={give} onChange={setGive} available={purse} idPrefix="give" availableLabel="In your purse" />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGive(emptyAmounts())} disabled={amountTotal(give) === 0}>
              Clear
            </button>
            <ActionButton variant="gold" busy={busy} reason={amountTotal(give) > 0 ? giveReason : null} disabled={amountTotal(give) === 0} onClick={() => void contribute()}>
              Contribute
            </ActionButton>
          </div>
        </Panel>

        <Panel title="Pay out to an official" icon="key">
          {canPay ? (
            <>
              <p className="mb-3 text-sm text-muted">Moves treasury resources into an official&apos;s own purse. Every payment is recorded with your name.</p>
              <label className="mb-1 block text-sm font-bold" htmlFor="payee">
                Official
              </label>
              <select id="payee" className="field mb-3" value={payee} onChange={(e) => setPayee(e.target.value)}>
                <option value="">Choose an official…</option>
                {hub.members.map((m) => (
                  <option key={m.playerId} value={m.playerId}>
                    {m.nickname} — {m.roleName}
                    {m.isYou ? ' (you)' : ''}
                  </option>
                ))}
              </select>
              <ResourceInputs value={pay} onChange={setPay} available={treasury} idPrefix="pay" availableLabel="In the treasury" />
              <label className="mb-1 mt-3 block text-sm font-bold" htmlFor="pay-note">
                Note <span className="font-normal text-muted">(optional, shown in the history)</span>
              </label>
              <input id="pay-note" className="field" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="e.g. for the new residence" />
              <div className="mt-3 flex justify-end">
                <ActionButton variant="primary" busy={busy} reason={payee || amountTotal(pay) > 0 ? payReason : null} disabled={!payee && amountTotal(pay) === 0} onClick={() => void payOut()}>
                  Pay out
                </ActionButton>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">{session.lacks('treasury')}. The {ROLE_DEFS.treasurer.name} and the {ROLE_DEFS.leader.name} hold the keys.</p>
          )}
        </Panel>
      </div>

      <div className="space-y-4 lg:space-y-5">
        <Panel title="Who has contributed" icon="ranking" bodyClassName="p-0">
          <ol className="divide-y divide-gold/10">
            {hub.treasury.contributions.map((c, i) => (
              <li key={c.playerId} className="flex items-center gap-3 px-4 py-2.5">
                <span className={cx('seal seal-sm', i === 0 && c.points > 0 ? 'seal-gold' : 'seal-ink')}>{i + 1}</span>
                <div className="min-w-0 flex-1 leading-tight">
                  <PlayerLink id={c.playerId} className="block truncate font-display font-bold">
                    {c.nickname}
                  </PlayerLink>
                  <div className="num mt-0.5 flex flex-wrap gap-x-2.5 text-xs text-muted">
                    {RESOURCE_KEYS.filter((k) => c.resources[k] > 0).map((k) => (
                      <span key={k} className="inline-flex items-center gap-1" title={RESOURCE_INFO[k].name}>
                        <Icon name={k} />
                        <span className="sr-only">{RESOURCE_INFO[k].name}</span>
                        {fmtCompact(c.resources[k])}
                      </span>
                    ))}
                    {c.points === 0 ? <span>nothing yet</span> : null}
                  </div>
                </div>
                <div className="text-right leading-tight">
                  <div className="num font-display text-lg font-bold text-gold-bright">{fmt(c.points)}</div>
                  <div className="text-[0.62rem] uppercase tracking-wider text-muted">points</div>
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Treasury record" icon="history" bodyClassName="p-0">
          {hub.treasury.log.length === 0 ? (
            <EmptyList title="Nothing recorded yet">Deposits, payments and everything bought from the National Treasury are written here.</EmptyList>
          ) : (
            <ul className="max-h-[32rem] divide-y divide-gold/10 overflow-y-auto">
              {hub.treasury.log.map((t) => (
                <LogRow key={t.id} entry={t} now={now} />
              ))}
            </ul>
          )}
          <p className="border-t border-gold/15 px-4 py-2 text-xs text-muted">The record cannot be changed. Hourly production and upkeep are left out to keep it readable.</p>
        </Panel>
      </div>
    </div>
  );
}

function PurseLine() {
  const { purse } = useSession();
  return (
    <span className="num inline-flex flex-wrap gap-x-2.5 align-baseline text-parchment">
      {RESOURCE_KEYS.map((k) => (
        <span key={k} className="inline-flex items-center gap-1" title={RESOURCE_INFO[k].name}>
          <span className="text-gold" aria-hidden>
            <Icon name={k} />
          </span>
          <span className="sr-only">{RESOURCE_INFO[k].name}</span>
          {fmt(purse[k])}
        </span>
      ))}
    </span>
  );
}

function LogRow({ entry, now }: { entry: TreasuryEntryDTO; now: number }) {
  const known = (RESOURCE_KEYS as readonly string[]).includes(entry.resource);
  const incoming = entry.amount >= 0;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className={cx('seal seal-sm', incoming ? 'seal-ink' : '')} aria-hidden>
        {known ? <Icon name={entry.resource as ResourceKey} /> : <Icon name="treasury" />}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm font-bold">{reasonLabel(entry.reason)}</div>
        <div className="truncate text-xs text-muted">
          {entry.actor ? `by ${entry.actor}` : 'by the realm'} · {now ? timeAgo(entry.createdAt, now) : fmtDateTime(entry.createdAt)}
        </div>
      </div>
      <div className="text-right leading-tight">
        <div className={cx('num font-bold', incoming ? 'text-jade' : 'text-vermilion-bright')}>
          {fmtSigned(entry.amount)} <span className="font-normal text-muted">{known ? RESOURCE_INFO[entry.resource as ResourceKey].name.toLowerCase() : entry.resource}</span>
        </div>
        <div className="num text-[0.68rem] text-muted">balance {fmt(entry.balanceAfter)}</div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function Settings({ hub, state }: { hub: ClanHubResponse; state: HubState }) {
  const session = useSession();
  const { mutate, busy } = useHubMutation(state);
  const { clan } = hub;
  const canEdit = session.can('manage_clan');
  const isLeader = hub.membership.role === 'leader';
  const [description, setDescription] = useState(clan.description);
  const [recruitment, setRecruitment] = useState<RecruitmentMode>(clan.recruitment);
  const [language, setLanguage] = useState(clan.language);
  const [role, setRole] = useState<ClanRole>('officer');
  // A ticked box shows at once; the server's answer then replaces it.
  const [pending, setPending] = useState<{ role: ClanRole; permissions: ClanPermission[] } | null>(null);
  const permissionsOf = (r: ClanRole): ClanPermission[] => (pending && pending.role === r ? pending.permissions : (hub.permissions[r] ?? []));
  const dirty = description !== clan.description || recruitment !== clan.recruitment || language !== clan.language;

  // Another officer may have changed the settings meanwhile.
  useEffect(() => {
    setDescription(clan.description);
    setRecruitment(clan.recruitment);
    setLanguage(clan.language);
  }, [clan.description, clan.recruitment, clan.language]);

  const toggle = (r: ClanRole, p: ClanPermission) => {
    const current = hub.permissions[r] ?? [];
    const next = current.includes(p) ? current.filter((x) => x !== p) : [...current, p];
    setPending({ role: r, permissions: next });
    void mutate('/api/clan/permissions', { role: r, permissions: next }, `${ROLE_DEFS[r].name}: permissions updated.`).finally(() => setPending(null));
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-5">
      <Panel title="Profile of the nation" icon="clan" className="self-start">
        {canEdit ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void mutate('/api/clan/settings', { description, recruitment, language }, 'The profile of the nation is saved.');
            }}
          >
            <label className="mb-1 block text-sm font-bold" htmlFor="clan-description">
              Description
            </label>
            <textarea id="clan-description" className="field min-h-[110px]" maxLength={CLAN_RULES.descriptionMax} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What the nation stands for, and who it is looking for." />
            <p className="num mt-1 text-right text-[0.68rem] text-faint">
              {description.length} / {CLAN_RULES.descriptionMax}
            </p>
            <fieldset className="mt-3">
              <legend className="mb-1.5 text-sm font-bold">Recruitment</legend>
              <div className="space-y-1.5" role="radiogroup" aria-label="Recruitment">
                {RECRUITMENT_MODES.map((m) => {
                  const active = recruitment === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setRecruitment(m)}
                      className={cx('flex w-full items-start gap-3 rounded-[3px] border px-3 py-2 text-left transition-colors', active ? 'border-gold bg-gold/12' : 'border-gold/15 hover:border-gold/50')}
                    >
                      <span className={cx('mt-1 h-3.5 w-3.5 shrink-0 rounded-full border', active ? 'border-gold bg-gold' : 'border-gold/50')} aria-hidden />
                      <span className="leading-snug">
                        <span className="block font-display font-bold">{RECRUITMENT_DEFS[m].name}</span>
                        <span className="block text-xs text-muted">{RECRUITMENT_DEFS[m].summary}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <label className="mb-1 mt-3 block text-sm font-bold" htmlFor="clan-language">
              Language
            </label>
            <select id="clan-language" className="field" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {CLAN_LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <div className="mt-4 flex justify-end">
              <ActionButton variant="gold" type="submit" busy={busy} disabled={!dirty}>
                Save profile
              </ActionButton>
            </div>
          </form>
        ) : (
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Description</dt>
              <dd className="mt-0.5 whitespace-pre-wrap break-words">{clan.description || 'No description yet.'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Recruitment</dt>
              <dd className="mt-0.5">
                {RECRUITMENT_DEFS[clan.recruitment].name} — {RECRUITMENT_DEFS[clan.recruitment].summary}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Language</dt>
              <dd className="mt-0.5">{CLAN_LANGUAGES.find((l) => l.id === clan.language)?.name ?? clan.language}</dd>
            </div>
            <p className="border-t border-gold/15 pt-3 text-xs text-muted">{session.lacks('manage_clan')}.</p>
          </dl>
        )}
        <p className="mt-3 border-t border-gold/15 pt-3 text-xs text-muted">
          The name <span className="font-bold text-parchment">{clan.name}</span> and tag <ClanTag tag={clan.tag} /> are fixed for as long as the nation stands.
        </p>
      </Panel>

      <Panel title="What each role may do" icon="key" bodyClassName="p-0">
        <p className="px-4 pt-3 text-sm text-muted">
          {isLeader ? 'Tick what each role may do. Changes take effect at once.' : `Only the ${ROLE_DEFS.leader.name} can change these.`} The {ROLE_DEFS.leader.name} may always do everything.
        </p>

        {/* phone: one role at a time */}
        <div className="p-4 md:hidden">
          <label className="mb-1 block text-sm font-bold" htmlFor="perm-role">
            Role
          </label>
          <select id="perm-role" className="field" value={role} onChange={(e) => setRole(e.target.value as ClanRole)}>
            {CONFIGURABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_DEFS[r].name}
              </option>
            ))}
          </select>
          <ul className="mt-3 space-y-1.5">
            {CLAN_PERMISSIONS.map((p) => {
              const on = permissionsOf(role).includes(p);
              return (
                <li key={p}>
                  <label className={cx('flex min-h-[48px] items-start gap-3 rounded-[3px] border px-3 py-2', on ? 'border-gold/50 bg-gold/8' : 'border-gold/15', isLeader && 'cursor-pointer')}>
                    <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[#c8a24a]" checked={on} disabled={!isLeader || busy} onChange={() => toggle(role, p)} />
                    <span className="leading-snug">
                      <span className="block text-sm font-bold">{PERMISSION_DEFS[p].name}</span>
                      <span className="block text-xs text-muted">{PERMISSION_DEFS[p].summary}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        {/* wider screens: the whole matrix */}
        <div className="hidden overflow-x-auto md:block">
          <table className="table-ink mt-2">
            <thead>
              <tr>
                <th>Permission</th>
                {CLAN_ROLES.map((r) => (
                  <th key={r} className="!px-1.5 !text-center" title={ROLE_DEFS[r].summary}>
                    <PermissionRoleHead role={r} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CLAN_PERMISSIONS.map((p) => (
                <tr key={p}>
                  <td className="min-w-[13rem]">
                    <div className="text-sm font-bold">{PERMISSION_DEFS[p].name}</div>
                    <div className="max-w-[22rem] text-xs text-muted">{PERMISSION_DEFS[p].summary}</div>
                  </td>
                  {CLAN_ROLES.map((r) => {
                    const on = r === 'leader' || permissionsOf(r).includes(p);
                    return (
                      <td key={r} className="!px-1.5 text-center">
                        {r === 'leader' || !isLeader ? (
                          <span className={on ? 'text-gold-bright' : 'text-faint'} aria-label={`${ROLE_DEFS[r].name}: ${on ? 'allowed' : 'not allowed'}`}>
                            <Icon name={on ? 'check' : 'dot'} size={on ? '1.2em' : '0.7em'} />
                          </span>
                        ) : (
                          <input type="checkbox" className="h-4 w-4 cursor-pointer accent-[#c8a24a]" checked={on} disabled={busy} onChange={() => toggle(r, p)} aria-label={`${ROLE_DEFS[r].name} may: ${PERMISSION_DEFS[p].name}`} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function PermissionRoleHead({ role }: { role: ClanRole }) {
  const name = ROLE_DEFS[role].name;
  // Two-word titles break onto two lines so eight columns fit.
  const parts = name.split(' ');
  return (
    <span className="block text-[0.68rem] leading-tight">
      {parts.map((part) => (
        <span key={part} className="block">
          {part}
        </span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

const ACTIVITY_ICON: Record<string, IconName> = {
  joined: 'members',
  left: 'leave',
  removed: 'leave',
  role: 'star',
  leadership: 'crown',
  invited: 'mail',
  contribution: 'purse',
  withdrawal: 'key',
  settings: 'settings',
  permissions: 'key',
  announcement: 'announce',
};

function History({ hub }: { hub: ClanHubResponse }) {
  const now = useNow();
  return (
    <Panel title="History of the nation" icon="history" bodyClassName="p-0">
      {hub.activity.length === 0 ? (
        <EmptyList title="The record is empty">Officials joining and leaving, appointments, deposits and payments are written here.</EmptyList>
      ) : (
        <ol className="divide-y divide-gold/10">
          {hub.activity.map((a) => (
            <li key={a.id} className="flex items-start gap-3 px-4 py-2.5">
              <span className="seal seal-sm seal-ink mt-0.5" aria-hidden>
                <Icon name={ACTIVITY_ICON[a.type] ?? 'scroll'} />
              </span>
              <p className="min-w-0 flex-1 break-words text-sm leading-relaxed">{a.body}</p>
              <span className="num shrink-0 pt-0.5 text-[0.7rem] text-muted">{now ? timeAgo(a.createdAt, now) : fmtDateTime(a.createdAt)}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
