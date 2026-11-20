'use client';

/** Player profile: who someone is, what they have learned, and how to reach them. */
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { ClanHubResponse, PlayerProfileResponse } from '@/game/api';
import { PILLARS, PILLAR_DEFS } from '@/game/pillars';
import { ClanLink, ClanTag } from '@/components/clan';
import { Icon } from '@/components/icons';
import { Portrait } from '@/components/Portrait';
import { ActionButton, ErrorState, LoadingState, Panel, Stat } from '@/components/ui';
import { apiPost } from '@/lib/api';
import { fmt, fmtDateTime } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

export default function PlayerProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const state = useApi<PlayerProfileResponse>(id ? `/api/players/${id}` : null, ['clan:updated', 'clan:directory', 'pillars:updated']);
  const invite = useAction();

  return (
    <div>
      <button type="button" onClick={() => router.back()} className="mb-3 inline-flex min-h-[44px] items-center gap-1.5 text-sm text-muted hover:text-parchment">
        ← Back
      </button>
      {state.error && !state.data ? (
        <ErrorState message={state.error.message} onRetry={() => void state.refresh()} />
      ) : !state.data ? (
        <LoadingState label="Looking them up in the register…" />
      ) : (
        <Profile
          data={state.data}
          inviting={invite.busy}
          onInvite={() =>
            void invite.run(() => apiPost<ClanHubResponse>('/api/clan/invitations', { nickname: state.data!.player.nickname }), {
              success: `An invitation is on its way to ${state.data!.player.nickname}.`,
            })
          }
        />
      )}
    </div>
  );
}

function Profile({ data, onInvite, inviting }: { data: PlayerProfileResponse; onInvite: () => void; inviting: boolean }) {
  const p = data.player;
  const top = Math.max(...PILLARS.map((id) => data.pillars[id]));
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-5">
      <section className="panel self-start p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-4">
          <Portrait id={p.portrait} accent={p.bannerColor ?? undefined} size={96} className="shrink-0" />
          <div className="min-w-0 flex-1 basis-48">
            <h1 className="break-words font-display text-2xl font-extrabold leading-tight sm:text-3xl">{p.nickname}</h1>
            <p className="mt-1 text-sm text-parchment/85">
              {p.clanId ? (
                <>
                  {p.roleName} of{' '}
                  <ClanLink id={p.clanId} className="font-bold">
                    {p.clanName}
                  </ClanLink>{' '}
                  <ClanTag tag={p.clanTag} />
                </>
              ) : (
                'Without a nation'
              )}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="chip">Level {p.level}</span>
              {data.isViewer ? <span className="chip chip-jade">This is you</span> : null}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-gold/15 pt-3">
          {data.isViewer ? (
            <>
              <Link href="/game/pillars" className="btn btn-sm btn-gold">
                Your Five Pillars
              </Link>
              <Link href="/game/settings" className="btn btn-sm">
                Change portrait
              </Link>
            </>
          ) : (
            <>
              <Link href={`/game/messages?with=${p.playerId}`} className="btn btn-sm btn-gold">
                <Icon name="mail" /> Message
              </Link>
              {data.canInvite ? (
                <ActionButton size="sm" busy={inviting} onClick={onInvite}>
                  Invite to your nation
                </ActionButton>
              ) : null}
            </>
          )}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-gold/15 pt-3 sm:grid-cols-4">
          <Stat label="Battles led" value={fmt(data.battlesLed)} hint={`${fmt(data.battlesWon)} won`} />
          <Stat label="Reputation" value={fmt(data.reputation)} />
          <Stat label="Contribution" value={fmt(data.contribution)} hint={p.clanId ? 'to their nation' : undefined} />
          <Stat label="In the realm since" value={<span className="text-base">{fmtDateTime(data.createdAt)}</span>} hint={data.joinedClanAt ? `in this nation since ${fmtDateTime(data.joinedClanAt)}` : undefined} />
        </dl>
      </section>

      <Panel title="Five Pillars" icon="pillars" className="self-start">
        <ul className="space-y-2.5">
          {PILLARS.map((id) => (
            <li key={id} className="flex items-center gap-3">
              <span className={`seal seal-sm ${data.pillars[id] === top && top > 1 ? '' : 'seal-ink'}`} aria-hidden>
                <Icon name={id} />
              </span>
              <span className="min-w-0 flex-1 truncate font-display font-bold">{PILLAR_DEFS[id].name}</span>
              <span className="num text-sm font-bold text-gold-bright">Lv {data.pillars[id]}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-gold/15 pt-3 text-xs leading-relaxed text-muted">Pillars belong to the player and go with them from nation to nation. In a nation, the right cabinet seat lets a specialist carry their pillar for everyone.</p>
      </Panel>
    </div>
  );
}
