'use client';

import type { LeaderboardResponse } from '@/game/api';
import { Banner } from '@/components/Banner';
import { Portrait } from '@/components/Portrait';
import { EmptyState, ErrorState, LoadingState, PageHeader, Panel } from '@/components/ui';
import { EVENTS } from '@/lib/events';
import { cx, fmt } from '@/lib/format';
import { useGame } from '@/lib/game-context';
import { useApi } from '@/lib/hooks';

import { Glyph } from '@/components/icons';
const PLACE = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

export default function RankingPage() {
  const state = useApi<LeaderboardResponse>('/api/leaderboard', EVENTS.ranking);
  const { world } = useGame();

  if (state.error && !state.data) return <ErrorState message={state.error.message} onRetry={() => void state.refresh()} />;
  if (!state.data) return <LoadingState label="The heralds are counting banners…" />;
  const entries = state.data.entries;

  return (
    <div>
      <PageHeader kanji="位" title="Ranking" subtitle={`The standing of every clan in Kansai. Hold ${world.hegemonyProvinces} provinces to be proclaimed hegemon.`} />
      {entries.length === 0 ? (
        <EmptyState title="No clans yet" />
      ) : (
        <Panel bodyClassName="p-0" className="overflow-hidden">
          {/* desktop table */}
          <table className="table-ink hidden md:table">
            <thead>
              <tr>
                <th className="w-16">Rank</th>
                <th>Clan</th>
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
                          {e.clan.name}
                          {e.isViewer ? <span className="chip ml-2 align-middle">You</span> : null}
                          {world.hegemon?.clanId === e.clan.id ? <span className="chip chip-red ml-2 align-middle">Hegemon</span> : null}
                          {e.clan.status === 'fallen' ? <span className="chip chip-muted ml-2 align-middle">Fallen</span> : null}
                        </div>
                        <div className="text-xs text-muted">
                          {e.clan.daimyoName} · {e.clan.isNpc ? 'rival daimyo' : (e.clan.playerNickname ?? 'player')}
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
                    {e.clan.name}
                    {e.isViewer ? <span className="chip ml-1.5 align-middle">You</span> : null}
                  </div>
                  <div className="truncate text-xs text-muted">{e.clan.daimyoName}</div>
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
      <p className="mt-3 text-xs leading-relaxed text-muted">Renown weighs land held, people ruled, armies kept and the growth of the Five Pillars. The world does not end when a hegemon is proclaimed — it only gives every other clan a common enemy.</p>
    </div>
  );
}
