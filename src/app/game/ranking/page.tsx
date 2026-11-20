'use client';

import { useState } from 'react';
import type { LeaderboardResponse, PlayerRankDTO } from '@/game/api';
import { Banner } from '@/components/Banner';
import { ClanLink, ClanTag, PlayerLink } from '@/components/clan';
import { Portrait } from '@/components/Portrait';
import { EmptyState, ErrorState, LoadingState, PageHeader, Panel, Tabs } from '@/components/ui';
import { EVENTS } from '@/lib/events';
import { cx, fmt } from '@/lib/format';
import { useSession } from '@/lib/game-context';
import { useApi } from '@/lib/hooks';

const PLACE = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
type Tab = 'clans' | 'players';

export default function RankingPage() {
  const state = useApi<LeaderboardResponse>('/api/leaderboard', [...EVENTS.ranking, 'clan:directory', 'clan:updated']);
  const { world } = useSession();
  const [tab, setTab] = useState<Tab>('clans');

  if (state.error && !state.data) return <ErrorState message={state.error.message} onRetry={() => void state.refresh()} />;
  if (!state.data) return <LoadingState label="Counting the nations of the realm…" />;
  const entries = state.data.entries;

  return (
    <div>
      <PageHeader icon="ranking" title="Ranking" subtitle={`The standing of every nation and every player in Kansai. A nation that holds ${world.hegemonyProvinces} provinces is proclaimed hegemon.`} />
      <Tabs<Tab>
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'clans', label: 'Nations' },
          { id: 'players', label: 'Players' },
        ]}
      />
      {tab === 'players' ? (
        <Players players={state.data.players} />
      ) : entries.length === 0 ? (
        <EmptyState title="No nations yet" />
      ) : (
        <Panel bodyClassName="p-0" className="overflow-hidden">
          {/* desktop table */}
          <table className="table-ink hidden md:table">
            <thead>
              <tr>
                <th className="w-16">Rank</th>
                <th>Nation</th>
                <th className="!text-right">Provinces</th>
                <th className="!text-right">People</th>
                <th className="!text-right">Pillar levels</th>
                <th className="!text-right">Renown</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.clan.id} className={cx(e.isViewer && 'bg-gold/10', e.clan.status === 'fallen' && 'opacity-50')}>
                  <td>
                    <span className={cx('seal', e.rank === 1 ? 'seal-gold' : e.rank > 3 ? 'seal-ink' : '')}>{PLACE[e.rank - 1] ?? e.rank}</span>
                  </td>
                  <td>
                    <div className="flex items-center gap-3">
                      <Portrait id={e.clan.portrait} accent={e.clan.banner.color} size={44} />
                      <Banner color={e.clan.banner.color} mon={e.clan.banner.mon} size={40} />
                      <div className="leading-tight">
                        <div className="font-display text-base font-bold">
                          <ClanLink id={e.clan.id}>{e.clan.name}</ClanLink> <ClanTag tag={e.clan.tag} />
                          {e.isViewer ? <span className="chip ml-2 align-middle">Your nation</span> : null}
                          {world.hegemon?.clanId === e.clan.id ? <span className="chip chip-red ml-2 align-middle">Hegemon</span> : null}
                          {e.clan.status === 'fallen' ? <span className="chip chip-muted ml-2 align-middle">Fallen</span> : null}
                        </div>
                        <div className="text-xs text-muted">
                          {e.clan.isNpc ? `${e.clan.daimyoName} · rival government` : `led by ${e.clan.playerNickname ?? e.clan.daimyoName} · ${e.clan.memberCount} ${e.clan.memberCount === 1 ? 'official' : 'officials'}`}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="num text-right font-bold">{e.provinces}</td>
                  <td className="num text-right">{fmt(e.population)}</td>
                  <td className="num text-right">{e.pillarLevels}</td>
                  <td className="num text-right font-display text-lg font-bold text-gold-bright">{fmt(e.score)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* mobile cards */}
          <ol className="divide-y divide-gold/10 md:hidden">
            {entries.map((e) => (
              <li key={e.clan.id} className={cx('flex items-center gap-3 px-3.5 py-3', e.isViewer && 'bg-gold/10', e.clan.status === 'fallen' && 'opacity-50')}>
                <span className={cx('seal', e.rank === 1 ? 'seal-gold' : e.rank > 3 ? 'seal-ink' : '')}>{PLACE[e.rank - 1] ?? e.rank}</span>
                <Banner color={e.clan.banner.color} mon={e.clan.banner.mon} size={42} />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate font-display text-base font-bold">
                    <ClanLink id={e.clan.id}>{e.clan.name}</ClanLink> <ClanTag tag={e.clan.tag} />
                    {e.isViewer ? <span className="chip ml-1.5 align-middle">Yours</span> : null}
                  </div>
                  <div className="truncate text-xs text-muted">{e.clan.isNpc ? `${e.clan.daimyoName} · rival government` : `led by ${e.clan.playerNickname ?? e.clan.daimyoName}`}</div>
                  <div className="num mt-0.5 text-xs text-parchment/80">
                    {e.provinces} prov · {fmt(e.population)} people · pillars {e.pillarLevels}
                  </div>
                </div>
                <div className="text-right leading-tight">
                  <div className="num font-display text-lg font-bold text-gold-bright">{fmt(e.score)}</div>
                  <div className="text-[0.62rem] uppercase tracking-wider text-muted">renown</div>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      )}
      <p className="mt-3 text-xs leading-relaxed text-muted">
        {tab === 'clans'
          ? 'Renown weighs land held, people ruled and the strength of its cabinet in the Five Pillars. The world does not end when a hegemon is proclaimed — it only gives every other nation a common enemy.'
          : 'A player is ranked by their own level in the Five Pillars, what they have paid into their nation, the battles they have led to victory and their reputation.'}
      </p>
    </div>
  );
}

function Players({ players }: { players: PlayerRankDTO[] }) {
  if (players.length === 0) return <EmptyState icon="user" title="No players yet" />;
  return (
    <Panel bodyClassName="p-0" className="overflow-hidden">
      <ol className="divide-y divide-gold/10">
        {players.map((p) => (
          <li key={p.playerId} className={cx('flex items-center gap-3 px-3.5 py-2.5 sm:px-4', p.isViewer && 'bg-gold/10')}>
            <span className={cx('seal shrink-0', p.rank === 1 ? 'seal-gold' : p.rank > 3 ? 'seal-ink' : '')}>{p.rank}</span>
            <Portrait id={p.portrait} size={42} className="shrink-0" />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate font-display text-base font-bold">
                <PlayerLink id={p.playerId}>{p.nickname}</PlayerLink>
                {p.isViewer ? <span className="chip ml-2 align-middle">You</span> : null}
              </div>
              <div className="truncate text-xs text-muted">
                {p.clanId ? (
                  <>
                    {p.roleName} · <ClanLink id={p.clanId}>{p.clanName}</ClanLink> <ClanTag tag={p.clanTag} />
                  </>
                ) : (
                  'Without a nation'
                )}
              </div>
              <div className="num mt-0.5 flex flex-wrap gap-x-3 text-xs text-parchment/80">
                <span>Level {p.level}</span>
                <span>{fmt(p.contribution)} contributed</span>
                <span>
                  {p.battlesWon} {p.battlesWon === 1 ? 'victory' : 'victories'}
                </span>
              </div>
            </div>
            <div className="shrink-0 text-right leading-tight">
              <div className="num font-display text-lg font-bold text-gold-bright">{fmt(p.score)}</div>
              <div className="text-[0.62rem] uppercase tracking-wider text-muted">standing</div>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
