'use client';

import Link from 'next/link';
import type { ClanSelfDTO, WorldEventDTO, WorldMapResponse, WorldMetaDTO } from '@/game/api';
import { RESOURCE_INFO, RESOURCE_KEYS, totalUnits } from '@/game/config';
import { Banner } from '@/components/Banner';
import { Portrait } from '@/components/Portrait';
import { Bar, Countdown, EmptyState, ErrorState, LoadingState, Panel, Stat } from '@/components/ui';
import { useNow } from '@/lib/clock';
import { EVENTS } from '@/lib/events';
import { cx, fmt, fmtSigned, hourName } from '@/lib/format';
import { useGame } from '@/lib/game-context';
import { useApi } from '@/lib/hooks';
import { gameDateText } from '@/lib/world';

import { Icon } from '@/components/icons';
export default function OverviewPage() {
  const { clan, world, resources } = useGame();
  const map = useApi<WorldMapResponse>('/api/world/map', EVENTS.map);
  const now = useNow();

  const protectedUntil = clan.protectedUntil && Date.parse(clan.protectedUntil) > now ? clan.protectedUntil : null;
  const own = map.data?.provinces.filter((p) => p.relation === 'own') ?? [];
  const ownIds = new Set(own.map((p) => p.id));
  const besieged = own.filter((p) => p.underAttack);
  const incoming = map.data?.movements.filter((m) => !m.own && m.intent === 'attack' && ownIds.has(m.toProvinceId)) ?? [];
  const campaigns = map.data?.movements.filter((m) => m.own) ?? [];
  const provinceName = (id: string) => map.data?.provinces.find((p) => p.id === id)?.name ?? '—';
  const isHegemon = world.hegemon?.clanId === clan.id;

  return (
    <div className="space-y-4 lg:space-y-5">
      {/* masthead */}
      <section className="paper overflow-hidden">
        <div className="flex items-center gap-4 p-4 sm:p-5">
          <Portrait id={clan.portrait} accent={clan.banner.color} size={84} className="h-[68px] w-[68px] shrink-0 sm:h-[84px] sm:w-[84px]" title={`Portrait of ${clan.daimyoName}`} />
          <div className="min-w-0 flex-1">
            <p className="text-[0.7rem] uppercase tracking-[0.18em] text-ink-600">
              Day {world.day} · hour of the {hourName(world.hour)}
            </p>
            <h1 className="break-words font-display text-[1.45rem] font-extrabold leading-tight sm:text-3xl">{clan.daimyoName}</h1>
            <p className="font-display text-base">
              Daimyo of the <strong>{clan.name}</strong> clan
              {isHegemon ? <span className="ml-2 chip chip-red">Hegemon of Kansai</span> : null}
            </p>
            <p className="mt-1 text-sm text-ink-700">
              Rank {clan.rank} in the realm · {fmt(clan.score)} renown
            </p>
          </div>
          <Banner color={clan.banner.color} mon={clan.banner.mon} size={92} className="hidden shrink-0 min-[420px]:block" title={`Banner of the ${clan.name} clan`} />
        </div>
      </section>

      {/* alerts */}
      {besieged.length > 0 || incoming.length > 0 || protectedUntil || clan.starving ? (
        <div className="space-y-2">
          {besieged.map((p) => (
            <Alert key={p.id} tone="red" kanji="戦">
              <strong>{p.name} is under attack.</strong> Your garrison is fighting at the walls.{' '}
              <Link href="/game/military" className="tap-link">
                See your battles
              </Link>
            </Alert>
          ))}
          {incoming.map((m) => (
            <Alert key={m.id} tone="red" kanji="敵">
              <strong>An enemy army marches on {provinceName(m.toProvinceId)}</strong> and arrives in <Countdown to={m.arrivesAt} className="font-bold" done="moments" />.
            </Alert>
          ))}
          {clan.starving ? (
            <Alert tone="red" kanji="飢">
              <strong>Your people are starving.</strong> Build farms or dismiss soldiers before loyalty collapses.
            </Alert>
          ) : null}
          {protectedUntil ? (
            <Alert tone="gold" kanji="護">
              <strong>Under the shogunate&apos;s truce</strong> for another <Countdown to={protectedUntil} className="font-bold text-gold-bright" done="a moment" />. No clan may attack you while it lasts; it ends early if you
              attack another clan.
            </Alert>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-5">
        {/* treasury */}
        <Panel title="Treasury" kanji="蔵" className="lg:col-span-1">
          <table className="table-ink">
            <thead>
              <tr>
                <th>Resource</th>
                <th className="!text-right">In store</th>
                <th className="!text-right">Per hour</th>
              </tr>
            </thead>
            <tbody>
              {RESOURCE_KEYS.map((k) => (
                <tr key={k}>
                  <td>
                    <span className="flex items-center gap-2">
                      <span className="seal seal-sm seal-ink" aria-hidden>
                        <Icon name={k} />
                      </span>
                      {RESOURCE_INFO[k].name}
                    </span>
                  </td>
                  <td className="num text-right font-bold">{fmt(resources[k])}</td>
                  <td className={cx('num text-right', clan.income.net[k] < 0 ? 'font-bold text-vermilion-bright' : 'text-jade')}>{fmtSigned(clan.income.net[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Harvest {fmt(clan.income.production.food)} · people eat {fmt(clan.income.populationFood)} · army eats {fmt(clan.income.upkeepFood)} food and is paid {fmt(clan.income.upkeepGold)} gold each hour.
          </p>
        </Panel>

        {/* realm */}
        <Panel title="Realm" kanji="領">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Provinces" value={clan.provinceCount} />
            <Stat label="People" value={fmt(clan.population)} />
            <Stat label="Rank" value={`#${clan.rank}`} />
          </div>
          <div className="mt-4">
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="text-muted">Road to hegemony</span>
              <span className="num font-bold">
                {clan.provinceCount} / {world.hegemonyProvinces}
              </span>
            </div>
            <Bar value={clan.provinceCount} max={world.hegemonyProvinces} label="Provinces held toward hegemony" />
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {isHegemon
                ? 'You are proclaimed hegemon of Kansai. Every rival now has reason to bring you down.'
                : `Hold ${world.hegemonyProvinces} of the ten home provinces to be proclaimed hegemon of Kansai — the first step toward the title of Shogun.`}
            </p>
          </div>
        </Panel>

        {/* army */}
        <Panel
          title="Army"
          kanji="軍"
          action={
            <Link href="/game/military" className="btn btn-sm">
              Command
            </Link>
          }
        >
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Soldiers" value={fmt(clan.army.total)} />
            <Stat label="Power" value={fmt(clan.army.power)} />
            <Stat label="Mustering" value={fmt(clan.army.recruiting)} />
          </div>
          <div className="mt-4">
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="text-muted">Army capacity</span>
              <span className="num font-bold">
                {fmt(clan.army.total + clan.army.recruiting)} / {fmt(clan.army.capacity)}
              </span>
            </div>
            <Bar value={clan.army.total + clan.army.recruiting} max={clan.army.capacity} tone={clan.army.total + clan.army.recruiting >= clan.army.capacity ? 'red' : 'gold'} label="Army capacity used" />
            <p className="mt-2 text-xs leading-relaxed text-muted">Raise capacity with castle levels and the Leadership pillar.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-5">
        <div className="space-y-4 lg:col-span-2 lg:space-y-5">
          <Panel
            title="Your provinces"
            kanji="国"
            action={
              <Link href="/game/map" className="btn btn-sm">
                Open map
              </Link>
            }
            bodyClassName="p-0"
          >
            {map.error && !map.data ? (
              <ErrorState message={map.error.message} onRetry={() => void map.refresh()} />
            ) : !map.data ? (
              <LoadingState />
            ) : own.length === 0 ? (
              <EmptyState title="You hold no land">Your banners fly over no province.</EmptyState>
            ) : (
              <ul className="divide-y divide-gold/10">
                {own.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                    <div className="paper grid h-11 w-11 shrink-0 place-items-center font-display text-lg font-bold">{p.kanji}</div>
                    <div className="min-w-[7rem] flex-1">
                      <div className="font-display text-base font-bold leading-tight">
                        {p.name}
                        {p.isCapital ? <span className="chip ml-2 align-middle">Capital</span> : null}
                        {p.underAttack ? <span className="chip chip-red ml-2 align-middle">Under attack</span> : null}
                      </div>
                      <div className="num text-xs text-muted">
                        Castle Lv {p.castleLevel} · {fmt(p.population)} people · {fmt(p.garrison ? totalUnits(p.garrison) : 0)} soldiers
                      </div>
                    </div>
                    <div className="w-28">
                      <div className="mb-1 flex justify-between text-[0.66rem] uppercase tracking-wider text-muted">
                        <span>Loyalty</span>
                        <span className="num">{p.loyalty !== null ? Math.round(p.loyalty) : '—'}</span>
                      </div>
                      <Bar value={p.loyalty ?? 0} max={100} tone={(p.loyalty ?? 0) < 30 ? 'red' : (p.loyalty ?? 0) >= 70 ? 'jade' : 'gold'} label={`Loyalty of ${p.name}`} />
                    </div>
                    <Link href={`/game/castle?province=${p.id}`} className="btn btn-sm">
                      Manage
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {campaigns.length > 0 ? (
            <Panel title="Armies on the march" kanji="進">
              <ul className="space-y-2">
                {campaigns.map((m) => (
                  <li key={m.id} className="panel-flat flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                    <span className={m.intent === 'attack' ? 'chip chip-red' : 'chip chip-muted'}>{m.intent === 'attack' ? 'Attack' : m.intent === 'return' ? 'Returning' : 'Move'}</span>
                    <span className="min-w-0 flex-1 font-display font-bold">
                      {provinceName(m.fromProvinceId)} → {provinceName(m.toProvinceId)}
                    </span>
                    <span className="num text-sm text-muted">{m.total !== null ? `${fmt(m.total)} soldiers` : ''}</span>
                    {m.status === 'besieging' && m.battleId ? (
                      <Link href={`/game/battles/${m.battleId}`} className="tap-link text-sm font-bold text-vermilion-bright">
                        fighting
                      </Link>
                    ) : (
                      <Countdown to={m.arrivesAt} className="text-sm font-bold text-gold-bright" done="arriving" onDone={() => void map.refresh()} />
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Counsel clan={clan} world={world} ownCount={own.length} hasUnclaimedNeighbour={Boolean(map.data?.provinces.some((p) => p.relation === 'unclaimed' && p.strength))} />
        </div>

        <Chronicle world={world} entries={map.data?.chronicle} loading={!map.data && !map.error} />
      </div>
    </div>
  );
}

function Alert({ tone, kanji, children }: { tone: 'red' | 'gold'; kanji: string; children: React.ReactNode }) {
  return (
    <div
      role={tone === 'red' ? 'alert' : 'status'}
      className={cx('flex items-start gap-3 rounded-[4px] border px-3.5 py-3 text-sm leading-relaxed', tone === 'red' ? 'border-vermilion-bright/60 bg-vermilion/20' : 'border-gold/40 bg-gold/10')}
    >
      <span className={cx('seal seal-sm mt-0.5', tone === 'gold' && 'seal-gold')} aria-hidden>
        {kanji}
      </span>
      <p className="min-w-0 flex-1">{children}</p>
    </div>
  );
}

/** Advice from the retainers, derived from what the server reports. */
function Counsel({ clan, world, ownCount, hasUnclaimedNeighbour }: { clan: ClanSelfDTO; world: WorldMetaDTO; ownCount: number; hasUnclaimedNeighbour: boolean }) {
  const advice: { kanji: string; text: React.ReactNode; href: string; cta: string }[] = [];
  if (clan.income.net.food < 0) {
    advice.push({ kanji: '米', text: 'The granaries are draining. Raise the Farm, or the army will eat the province bare.', href: '/game/castle', cta: 'Castle' });
  }
  if (clan.army.total + clan.army.recruiting < clan.army.capacity * 0.6) {
    advice.push({ kanji: '兵', text: 'Our captains can lead far more men than we have under arms. Muster soldiers at the Barracks.', href: '/game/military', cta: 'Recruit' });
  }
  if (ownCount <= 1 && hasUnclaimedNeighbour) {
    advice.push({ kanji: '攻', text: 'An unclaimed neighbour is held only by local warriors. Scout it, then march — a second province doubles our strength.', href: '/game/map', cta: 'Map' });
  }
  advice.push({ kanji: '柱', text: 'Every deed sharpens one of the Five Pillars. Spend skill points as they come — a lord who specialises outgrows one who does not.', href: '/game/pillars', cta: 'Pillars' });
  if (clan.provinceCount < world.hegemonyProvinces && ownCount > 1) {
    advice.push({ kanji: '交', text: 'To take land from another clan, war must first be declared. Weigh their strength and their friends before you do.', href: '/game/diplomacy', cta: 'Diplomacy' });
  }
  return (
    <Panel title="Counsel of your retainers" kanji="議">
      <ul className="space-y-2.5">
        {advice.slice(0, 4).map((a) => (
          <li key={a.kanji} className="flex items-center gap-3">
            <span className="seal seal-sm seal-ink" aria-hidden>
              {a.kanji}
            </span>
            <p className="min-w-0 flex-1 text-sm leading-relaxed text-parchment/90">{a.text}</p>
            <Link href={a.href} className="btn btn-sm shrink-0">
              {a.cta}
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

const EVENT_KANJI: Record<string, string> = {
  conquest: '征',
  war: '戦',
  peace: '和',
  famine: '飢',
  harvest: '豊',
  merchants: '商',
  earthquake: '震',
  rebellion: '乱',
  founding: '興',
  hegemony: '覇',
  fall: '滅',
};

function Chronicle({ world, entries, loading }: { world: WorldMetaDTO; entries: WorldEventDTO[] | undefined; loading: boolean }) {
  return (
    <section className="paper self-start">
      <header className="flex items-center gap-3 border-b border-ink-900/25 px-4 py-3">
        <span className="seal seal-sm" aria-hidden>
          記
        </span>
        <h2 className="flex-1 font-display text-[1.05rem] font-bold tracking-wide">Chronicle of the Realm</h2>
      </header>
      <div className="max-h-[34rem] overflow-y-auto px-4 py-3">
        {loading ? (
          <p className="py-6 text-center text-sm text-ink-600">The scribes are writing…</p>
        ) : !entries || entries.length === 0 ? (
          <p className="py-6 text-center font-display text-sm italic text-ink-600">Nothing of note has yet been set down. The brush waits.</p>
        ) : (
          <ol className="space-y-3.5">
            {entries.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center border border-ink-900/50 font-display text-sm font-bold text-vermilion-deep" aria-hidden>
                  {EVENT_KANJI[e.type] ?? '事'}
                </span>
                <div className="min-w-0">
                  <p className="text-[0.66rem] uppercase tracking-[0.12em] text-ink-600">{gameDateText(world, e.startsAt)}</p>
                  <p className="font-display text-[0.98rem] font-bold leading-snug">{e.title}</p>
                  <p className="font-display text-[0.9rem] leading-relaxed text-ink-800">{e.description}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
