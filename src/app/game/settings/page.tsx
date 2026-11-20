'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { MeResponse } from '@/game/api';
import { GAME_NAME, GAME_SUBTITLE, PORTRAITS } from '@/game/config';
import { Banner } from '@/components/Banner';
import { ClanTag } from '@/components/clan';
import { Portrait } from '@/components/Portrait';
import { ActionButton, PageHeader, Panel } from '@/components/ui';
import { apiPost } from '@/lib/api';
import { cx, fmtDateTime, fmtDuration, hourName } from '@/lib/format';
import { useSession } from '@/lib/game-context';
import { useAction } from '@/lib/hooks';

export default function SettingsPage() {
  const { player, clan, membership, personal, world, online, refreshMe } = useSession();
  const router = useRouter();
  const action = useAction();
  const profile = useAction();

  const choosePortrait = (id: string) => {
    if (id === player.portrait) return;
    void profile.run(() => apiPost<MeResponse>('/api/player/profile', { portrait: id }), { success: 'Your portrait is changed.' }).then((res) => (res ? refreshMe() : undefined));
  };

  const logout = async () => {
    const res = await action.run(() => apiPost<{ ok: true }>('/api/auth/logout'));
    if (res) router.replace('/');
  };

  return (
    <div>
      <PageHeader icon="settings" title="Settings" subtitle="Your account, your portrait, your nation, and the world you play in." />
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
        <Panel title="Account" icon="user">
          <div className="mb-4 flex items-center gap-3">
            <Portrait id={player.portrait} accent={clan?.banner.color} size={64} />
            <div className="min-w-0 leading-tight">
              <div className="truncate font-display text-xl font-bold">{player.nickname}</div>
              <div className="text-sm text-muted">
                Level {personal.level} · reputation {personal.reputation}
              </div>
              <Link href={`/game/players/${player.id}`} className="tap-link text-xs text-gold">
                View your public profile
              </Link>
            </div>
          </div>
          <dl className="space-y-2.5 text-sm">
            <Row label="Nickname" value={player.nickname} />
            <Row label="Email" value={player.email} />
            <Row label="Joined" value={fmtDateTime(player.createdAt)} />
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-muted">Your progress lives on the server. Sign in on any phone, tablet or computer and continue where you left off.</p>
          <ActionButton className="mt-4" busy={action.busy} onClick={() => void logout()}>
            Sign out
          </ActionButton>
        </Panel>

        <div className="space-y-4 lg:space-y-5">
          <Panel title="Your portrait" icon="user">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-3 xl:grid-cols-6" role="radiogroup" aria-label="Portrait">
              {PORTRAITS.map((p) => {
                const active = player.portrait === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={profile.busy}
                    onClick={() => choosePortrait(p.id)}
                    className={cx('flex flex-col items-center gap-1 rounded-[3px] border p-1.5 transition-colors', active ? 'border-gold bg-gold/15' : 'border-gold/15 hover:border-gold/50')}
                  >
                    <Portrait id={p.id} accent={clan?.banner.color} size={60} />
                    <span className="text-center text-[0.66rem] leading-tight text-muted">{p.name.replace('The ', '')}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-muted">Shown beside your name in lists of officials, rankings and messages.</p>
          </Panel>

          <Panel title="Your nation" icon="clan">
            {clan ? (
              <div className="flex items-center gap-4">
                <Banner color={clan.banner.color} mon={clan.banner.mon} size={72} />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate font-display text-xl font-bold">
                    {clan.name} <ClanTag tag={clan.tag} />
                  </div>
                  <div className="truncate text-sm text-parchment/80">You are {membership?.roleName ?? 'an official'}</div>
                  <div className="mt-1 text-xs text-muted">
                    {clan.status === 'active' ? `Rank ${clan.rank} · ${clan.provinceCount} ${clan.provinceCount === 1 ? 'province' : 'provinces'} · ${clan.memberCount} ${clan.memberCount === 1 ? 'official' : 'officials'}` : 'Fallen — no land'}
                  </div>
                </div>
                <Link href="/game/clan" className="btn btn-sm shrink-0">
                  Open
                </Link>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <p className="min-w-0 flex-1 basis-48 text-sm text-muted">You serve no nation. Land, armies and the treasury are held by nations.</p>
                <Link href="/game/clans" className="btn btn-sm btn-gold shrink-0">
                  Find a nation
                </Link>
              </div>
            )}
          </Panel>
        </div>

        <Panel title="World" icon="globe" className="lg:col-span-2">
          <dl className="grid gap-x-8 gap-y-2.5 text-sm sm:grid-cols-2">
            <Row label="Game" value={`${GAME_NAME}: ${GAME_SUBTITLE}`} />
            <Row label="Region" value="Kansai — the home provinces (prototype world)" />
            <Row label="World speed" value={world.speed === 1 ? 'Real time' : `Test world ×${world.speed}`} />
            <Row label="One game hour" value={`${fmtDuration(world.tickIntervalMs)} of real time`} />
            <Row label="Calendar" value={`Day ${world.day}, hour of the ${hourName(world.hour)} (${String(world.hour).padStart(2, '0')}:00)`} />
            <Row label="World tick" value={`#${world.tickNumber}${world.behind ? ' · catching up' : ''}`} />
            <Row label="Hegemony" value={`${world.hegemonyProvinces} provinces`} />
            <Row label="Connection" value={online ? 'Connected' : 'Reconnecting…'} />
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-muted">
            The world is persistent and shared: production, construction, marches and battles are resolved by the server and continue while you are away. Nothing your device calculates is trusted — it only shows what the server
            reports.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-gold/10 pb-2">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium">{value}</dd>
    </div>
  );
}
