'use client';

import { useRouter } from 'next/navigation';
import { GAME_NAME, GAME_SUBTITLE } from '@/game/config';
import { Banner } from '@/components/Banner';
import { Portrait } from '@/components/Portrait';
import { ActionButton, PageHeader, Panel } from '@/components/ui';
import { apiPost } from '@/lib/api';
import { fmtDateTime, fmtDuration, hourName } from '@/lib/format';
import { useGame } from '@/lib/game-context';
import { useAction } from '@/lib/hooks';

export default function SettingsPage() {
  const { player, clan, world, online } = useGame();
  const router = useRouter();
  const action = useAction();

  const logout = async () => {
    const res = await action.run(() => apiPost<{ ok: true }>('/api/auth/logout'));
    if (res) router.replace('/');
  };

  return (
    <div>
      <PageHeader kanji="設" title="Settings" subtitle="Your account, your house, and the world you play in." />
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
        <Panel title="Account" kanji="人">
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

        <Panel title="Your house" kanji="家">
          <div className="flex items-center gap-4">
            <Portrait id={clan.portrait} accent={clan.banner.color} size={76} />
            <Banner color={clan.banner.color} mon={clan.banner.mon} size={76} />
            <div className="min-w-0 leading-tight">
              <div className="truncate font-display text-xl font-bold">{clan.name} clan</div>
              <div className="truncate text-sm text-parchment/80">{clan.daimyoName}</div>
              <div className="mt-1 text-xs text-muted">
                Rank {clan.rank} · {clan.provinceCount} {clan.provinceCount === 1 ? 'province' : 'provinces'}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="World" kanji="世" className="lg:col-span-2">
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
