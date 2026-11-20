'use client';

/**
 * Shared pieces of the nation screens: tags, role badges, links to players and
 * clans, the one-button "join" action, resource amount inputs, and the states
 * shown to players who have no nation.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ClanDirectoryResponse, ClanJoinStateDTO, ClanPublicDTO, MeResponse } from '@/game/api';
import { CLAN_RULES, RECRUITMENT_DEFS, ROLE_DEFS, type ClanRole } from '@/game/clan';
import { RESOURCE_INFO, RESOURCE_KEYS, type ResourceBag } from '@/game/config';
import { apiPost } from '@/lib/api';
import { cx, fmt } from '@/lib/format';
import { useSession } from '@/lib/game-context';
import { useAction } from '@/lib/hooks';
import { Icon } from './icons';
import { ActionButton, Dialog, EmptyState, LoadingState } from './ui';

export function ClanTag({ tag, className }: { tag: string | null | undefined; className?: string }) {
  if (!tag) return null;
  return <span className={cx('num whitespace-nowrap text-[0.72em] font-bold tracking-wider text-gold', className)}>[{tag}]</span>;
}

const ROLE_TONE: Partial<Record<ClanRole, string>> = {
  leader: 'chip-red',
  officer: '',
  samurai: 'chip-muted',
  recruit: 'chip-muted',
};

export function RoleBadge({ role, className }: { role: ClanRole; className?: string }) {
  return (
    <span className={cx('chip whitespace-nowrap', ROLE_TONE[role] ?? 'chip-jade', className)} title={ROLE_DEFS[role].summary}>
      {ROLE_DEFS[role].name}
    </span>
  );
}

export function PlayerLink({ id, children, className }: { id: string | null | undefined; children: React.ReactNode; className?: string }) {
  if (!id) return <span className={className}>{children}</span>;
  return (
    <Link href={`/game/players/${id}`} className={cx('underline-offset-2 hover:text-gold-bright hover:underline', className)}>
      {children}
    </Link>
  );
}

export function ClanLink({ id, children, className }: { id: string | null | undefined; children: React.ReactNode; className?: string }) {
  if (!id) return <span className={className}>{children}</span>;
  return (
    <Link href={`/game/clans/${id}`} className={cx('underline-offset-2 hover:text-gold-bright hover:underline', className)}>
      {children}
    </Link>
  );
}

export function RecruitmentChip({ clan }: { clan: Pick<ClanPublicDTO, 'recruitment' | 'isNpc'> }) {
  if (clan.isNpc) return <span className="chip chip-muted whitespace-nowrap">Rival government</span>;
  const def = RECRUITMENT_DEFS[clan.recruitment];
  return (
    <span className={cx('chip whitespace-nowrap', clan.recruitment === 'open' ? 'chip-jade' : clan.recruitment === 'closed' ? 'chip-muted' : '')} title={def.summary}>
      {def.name}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------

/**
 * The one thing the viewer can do about joining this nation: join, apply,
 * accept an invitation, or withdraw an application — or the reason they cannot.
 */
export function JoinAction({
  clan,
  join,
  onDirectory,
  size,
  align = 'end',
}: {
  clan: Pick<ClanPublicDTO, 'id' | 'name'>;
  join: ClanJoinStateDTO;
  /** Called with the refreshed directory after applying or withdrawing. */
  onDirectory?: (res: ClanDirectoryResponse) => void;
  size?: 'sm';
  align?: 'start' | 'end';
}) {
  const router = useRouter();
  const session = useSession();
  const action = useAction();
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState('');

  const entered = async () => {
    await session.refreshMe();
    router.push('/game');
  };

  if (join.option === 'join') {
    return (
      <ActionButton
        variant="primary"
        size={size}
        busy={action.busy}
        onClick={() =>
          void action
            .run(() => apiPost<MeResponse>(`/api/clans/${clan.id}/join`), { success: `You have entered the service of ${clan.name}.` })
            .then((res) => (res ? entered() : undefined))
        }
      >
        Join
      </ActionButton>
    );
  }
  if (join.option === 'accept_invitation' && join.invitationId) {
    return (
      <span className={cx('inline-flex flex-wrap gap-2', align === 'end' && 'justify-end')}>
        <ActionButton
          variant="primary"
          size={size}
          busy={action.busy}
          onClick={() =>
            void action
              .run(() => apiPost<MeResponse>('/api/clan/invitations/respond', { invitationId: join.invitationId, accept: true }), {
                success: `You have entered the service of ${clan.name}.`,
              })
              .then((res) => (res ? entered() : undefined))
          }
        >
          Accept invitation
        </ActionButton>
        <ActionButton
          variant="ghost"
          size={size}
          busy={action.busy}
          onClick={() => void action.run(() => apiPost<MeResponse>('/api/clan/invitations/respond', { invitationId: join.invitationId, accept: false }), { success: 'Invitation declined.' })}
        >
          Decline
        </ActionButton>
      </span>
    );
  }
  if (join.option === 'applied' && join.applicationId) {
    return (
      <span className={cx('inline-flex flex-wrap items-center gap-2', align === 'end' && 'justify-end')}>
        <span className="chip whitespace-nowrap">Applied</span>
        <ActionButton
          variant="ghost"
          size={size}
          busy={action.busy}
          onClick={() =>
            void action
              .run(() => apiPost<ClanDirectoryResponse>('/api/clan/applications/withdraw', { applicationId: join.applicationId }), { success: 'Application withdrawn.' })
              .then((res) => (res ? onDirectory?.(res) : undefined))
          }
        >
          Withdraw
        </ActionButton>
      </span>
    );
  }
  if (join.option === 'apply') {
    return (
      <>
        <ActionButton variant="gold" size={size} onClick={() => setApplying(true)}>
          Apply
        </ActionButton>
        <Dialog
          open={applying}
          onClose={() => setApplying(false)}
          title={`Apply to ${clan.name}`}
          icon="scroll"
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setApplying(false)} disabled={action.busy}>
                Cancel
              </button>
              <ActionButton
                variant="gold"
                busy={action.busy}
                onClick={() =>
                  void action
                    .run(() => apiPost<ClanDirectoryResponse>(`/api/clans/${clan.id}/apply`, { message: message.trim() }), {
                      success: `Your application has been sent to ${clan.name}.`,
                    })
                    .then((res) => {
                      if (!res) return;
                      setApplying(false);
                      setMessage('');
                      onDirectory?.(res);
                    })
                }
              >
                Send application
              </ActionButton>
            </>
          }
        >
          <p className="text-sm text-parchment/90">The nation&apos;s government will read your request and decide. You can add a short message.</p>
          <label className="mt-3 block text-sm font-bold" htmlFor={`apply-${clan.id}`}>
            Message <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id={`apply-${clan.id}`}
            className="field mt-1 min-h-[88px]"
            maxLength={CLAN_RULES.applicationMessageMax}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What you bring to the nation…"
          />
          <p className="num mt-1 text-right text-[0.68rem] text-faint">
            {message.length} / {CLAN_RULES.applicationMessageMax}
          </p>
        </Dialog>
      </>
    );
  }
  return join.blockedReason ? <span className={cx('text-xs text-muted', align === 'end' && 'text-right')}>{join.blockedReason}</span> : null;
}

// ---------------------------------------------------------------------------
// Resource amounts
// ---------------------------------------------------------------------------

export type AmountBag = Record<keyof ResourceBag, number>;
export const emptyAmounts = (): AmountBag => ({ gold: 0, food: 0, wood: 0, stone: 0, iron: 0 });
export const amountTotal = (bag: AmountBag) => RESOURCE_KEYS.reduce((s, k) => s + bag[k], 0);

/** Five amount inputs, each capped by what is available, with a "max" shortcut. */
export function ResourceInputs({
  value,
  onChange,
  available,
  idPrefix,
  availableLabel,
}: {
  value: AmountBag;
  onChange: (next: AmountBag) => void;
  available: ResourceBag;
  idPrefix: string;
  availableLabel: string;
}) {
  return (
    <ul className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
      {RESOURCE_KEYS.map((k) => {
        const max = Math.max(0, Math.floor(available[k]));
        const over = value[k] > max;
        return (
          <li key={k} className="flex items-center gap-2">
            <label htmlFor={`${idPrefix}-${k}`} className="flex w-[5.2rem] shrink-0 items-center gap-1.5 text-sm">
              <span className="text-gold" aria-hidden>
                <Icon name={k} />
              </span>
              {RESOURCE_INFO[k].name}
            </label>
            <input
              id={`${idPrefix}-${k}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={max}
              className={cx('field num min-w-0 flex-1 !px-2 text-right', over && '!border-vermilion-bright')}
              value={value[k] === 0 ? '' : value[k]}
              placeholder="0"
              onChange={(e) => onChange({ ...value, [k]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
              aria-describedby={`${idPrefix}-${k}-max`}
            />
            <button
              type="button"
              id={`${idPrefix}-${k}-max`}
              className="num min-h-[40px] w-[4.6rem] shrink-0 rounded-[3px] border border-gold/15 px-1 text-right text-[0.72rem] text-muted hover:border-gold/50 hover:text-parchment"
              onClick={() => onChange({ ...value, [k]: max })}
              title={`${availableLabel}: ${fmt(max)}. Tap to use all of it.`}
            >
              of {fmt(max)}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Without a nation
// ---------------------------------------------------------------------------

export function NoClanState({ what }: { what?: string }) {
  return (
    <div className="panel mx-auto max-w-xl p-5 text-center sm:p-7">
      <span className="seal seal-lg mx-auto" aria-hidden>
        <Icon name="clan" />
      </span>
      <h1 className="mt-3 font-display text-2xl font-extrabold">You serve no nation yet</h1>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">
        {what ?? 'This screen belongs to a nation.'} Land, armies and the treasury are held by nations, not by single players. Enter the service of one, or found a government of your own.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link href="/game/clans" className="btn btn-primary">
          Find a nation
        </Link>
        <Link href="/found" className="btn btn-gold">
          Found your own nation
        </Link>
      </div>
    </div>
  );
}

export function FallenClanState() {
  const { clan, membership } = useSession();
  const leader = membership?.role === 'leader';
  return (
    <div className="panel mx-auto max-w-xl p-5 text-center sm:p-7">
      <span className="seal seal-lg mx-auto" aria-hidden>
        <Icon name="alert" />
      </span>
      <h1 className="mt-3 font-display text-2xl font-extrabold">{clan?.name} has fallen</h1>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">
        Its last province is lost. Everyone keeps what they have learned and what is in their purse.{' '}
        {leader ? 'As its head of government you can found a new capital in any open province.' : `Its ${ROLE_DEFS.leader.name} can found a new capital — or you can leave and join another nation.`}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {leader ? (
          <Link href="/found" className="btn btn-primary">
            Found a new capital
          </Link>
        ) : null}
        <Link href="/game/clan" className="btn btn-gold">
          Open the government
        </Link>
      </div>
    </div>
  );
}

const CLAN_ONLY = ['/game/castle', '/game/military', '/game/war', '/game/battles', '/game/diplomacy', '/game/intel'];
const WHAT: Record<string, string> = {
  '/game/castle': 'Provinces are governed by nations.',
  '/game/military': 'Armies are raised by nations.',
  '/game/war': 'War plans are made by the officials of a nation.',
  '/game/battles': 'Battle reports belong to the nations that fought.',
  '/game/diplomacy': 'War and peace are made between nations.',
  '/game/intel': 'Scouts are sent by nations.',
};

/**
 * Screens that manage a nation are only rendered for members of an active nation.
 * Everyone else gets a clear next step instead of an error.
 */
export function ClanGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { clan, hasClan } = useSession();
  const home = pathname === '/game';
  const section = CLAN_ONLY.find((p) => pathname === p || pathname.startsWith(`${p}/`));

  // A player without a nation starts at clan discovery.
  useEffect(() => {
    if (home && !clan) router.replace('/game/clans');
  }, [home, clan, router]);

  if (hasClan || (!home && !section)) return <>{children}</>;
  if (!clan) return home ? <LoadingState label="Looking for a nation to serve…" /> : <NoClanState what={section ? WHAT[section] : undefined} />;
  return <FallenClanState />;
}

export function EmptyList({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <EmptyState icon="scroll" title={title} className="!py-6">
      {children}
    </EmptyState>
  );
}
