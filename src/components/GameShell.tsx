'use client';

/**
 * Persistent game chrome: resource header, desktop sidebar, mobile bottom
 * navigation. Every gameplay screen is reachable on every screen size.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RESOURCE_INFO, RESOURCE_KEYS } from '@/game/config';
import { useGame } from '@/lib/game-context';
import { cx, fmt, fmtCompact, fmtSigned, hourName } from '@/lib/format';
import { Banner } from './Banner';
import { Brand } from './Brand';
import { Countdown } from './ui';

interface NavItem {
  href: string;
  label: string;
  kanji: string;
  purpose: string;
}

export const NAV: NavItem[] = [
  { href: '/game', label: 'Overview', kanji: '国', purpose: 'Kingdom dashboard' },
  { href: '/game/map', label: 'Japan Map', kanji: '図', purpose: 'Territory' },
  { href: '/game/castle', label: 'Castle', kanji: '城', purpose: 'Kingdom management' },
  { href: '/game/military', label: 'Military', kanji: '軍', purpose: 'Army and warfare' },
  { href: '/game/pillars', label: 'Five Pillars', kanji: '柱', purpose: 'Skill progression' },
  { href: '/game/diplomacy', label: 'Diplomacy', kanji: '交', purpose: 'Relationships' },
  { href: '/game/intel', label: 'Intelligence', kanji: '忍', purpose: 'Spy operations' },
  { href: '/game/ranking', label: 'Ranking', kanji: '位', purpose: 'Leaderboards' },
  { href: '/game/messages', label: 'Messages', kanji: '報', purpose: 'Communication' },
  { href: '/game/settings', label: 'Settings', kanji: '設', purpose: 'Profile and world' },
];

const MOBILE_PRIMARY = ['/game', '/game/map', '/game/castle', '/game/military'];

function isActive(pathname: string, href: string): boolean {
  if (href === '/game') return pathname === '/game';
  if (href === '/game/military') return pathname.startsWith('/game/military') || pathname.startsWith('/game/battles');
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Sidebar() {
  const pathname = usePathname();
  const { clan, world, unread, online } = useGame();
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-gold/20 bg-ink-950/90 backdrop-blur lg:flex">
      <div className="border-b border-gold/15 px-5 py-4">
        <Brand />
      </div>
      <div className="flex items-center gap-3 border-b border-gold/15 px-5 py-3.5">
        <Banner color={clan.banner.color} mon={clan.banner.mon} size={52} title={`Banner of the ${clan.name} clan`} />
        <div className="min-w-0">
          <div className="truncate font-display text-base font-bold leading-tight">{clan.name} clan</div>
          <div className="truncate text-xs text-muted">{clan.daimyoName}</div>
          <div className="mt-1 text-[0.68rem] uppercase tracking-wider text-gold">
            Rank {clan.rank} · {clan.provinceCount} {clan.provinceCount === 1 ? 'province' : 'provinces'}
          </div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2.5 py-3" aria-label="Main navigation">
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            const badge = item.href === '/game/messages' && unread > 0 ? unread : null;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'group flex min-h-[44px] items-center gap-3 rounded-[3px] border px-2.5 transition-colors',
                    active ? 'border-gold/40 bg-gold/10 text-parchment' : 'border-transparent text-muted hover:bg-parchment/5 hover:text-parchment',
                  )}
                >
                  <span className={cx('seal seal-sm', active ? '' : 'seal-ink')} aria-hidden>
                    {item.kanji}
                  </span>
                  <span className="flex-1 font-display text-[0.98rem] font-bold tracking-wide">{item.label}</span>
                  {badge ? <span className="num rounded-sm bg-vermilion px-1.5 py-0.5 text-[0.65rem] font-bold text-parchment-light">{badge > 99 ? '99+' : badge}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="space-y-1 border-t border-gold/15 px-5 py-3 text-[0.72rem] text-muted">
        <div className="flex items-center justify-between">
          <span>{world.speed === 1 ? 'Real-time world' : `Test world ×${world.speed}`}</span>
          <span className={cx('inline-flex items-center gap-1.5', online ? 'text-jade' : 'text-vermilion-bright')}>
            <span className={cx('h-1.5 w-1.5 rounded-full', online ? 'bg-jade' : 'bg-vermilion-bright')} />
            {online ? 'Connected' : 'Reconnecting'}
          </span>
        </div>
        <div>Kansai · the home provinces</div>
      </div>
    </aside>
  );
}

function GameClock({ className }: { className?: string }) {
  const { world } = useGame();
  return (
    <div className={cx('leading-tight', className)} title={`Day ${world.day}, hour of the ${hourName(world.hour)}. One game hour passes every tick.`}>
      <div className="num whitespace-nowrap font-display text-[0.95rem] font-bold">
        Day {world.day} <span className="text-gold">·</span> {String(world.hour).padStart(2, '0')}:00
      </div>
      <div className="num whitespace-nowrap text-[0.68rem] text-muted">
        next hour in <Countdown to={world.nextTickAt} className="text-gold-bright" done="now" />
      </div>
    </div>
  );
}

function Bell() {
  const { unread } = useGame();
  return (
    <Link
      href="/game/messages"
      className="relative grid h-11 w-11 shrink-0 place-items-center rounded-[3px] border border-gold/30 bg-gold/5 transition-colors hover:bg-gold/15"
      aria-label={unread > 0 ? `${unread} unread notifications` : 'Notifications'}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <path d="M6 16V11a6 6 0 0 1 12 0v5l1.6 2H4.4L6 16Z" strokeLinejoin="round" />
        <path d="M10 20.5h4M12 3v2" strokeLinecap="round" />
      </svg>
      {unread > 0 ? (
        <span className="num absolute -right-1.5 -top-1.5 min-w-[1.25rem] rounded-sm bg-vermilion px-1 text-center text-[0.66rem] font-bold leading-5 text-parchment-light shadow">
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </Link>
  );
}

function ResourceHeader() {
  const { clan, resources, world, online } = useGame();
  const net = clan.income.net;
  return (
    <header className="sticky top-0 z-30 border-b border-gold/20 bg-ink-950/92 backdrop-blur-md">
      {/* top row */}
      <div className="flex items-center gap-2 px-3 py-2 lg:gap-4 lg:px-6">
        <div className="lg:hidden">
          <Brand compact />
        </div>

        {/* desktop resources */}
        <ul className="hidden flex-1 items-center gap-1.5 lg:flex xl:gap-2.5" aria-label="Treasury">
          {RESOURCE_KEYS.map((k) => {
            const warn = k === 'food' && (clan.starving || net.food < 0);
            return (
              <li
                key={k}
                className={cx('flex items-center gap-2 rounded-[3px] border px-2 py-1.5 xl:px-2.5', warn ? 'border-vermilion-bright/60 bg-vermilion/15' : 'border-gold/15 bg-ink-800/60')}
                title={`${RESOURCE_INFO[k].name} — ${RESOURCE_INFO[k].purpose}`}
              >
                <span className={cx('seal seal-sm', warn ? '' : 'seal-ink')} aria-hidden>
                  {RESOURCE_INFO[k].kanji}
                </span>
                <span className="leading-tight">
                  <span className="sr-only">{RESOURCE_INFO[k].name}: </span>
                  <span className="num block text-[0.95rem] font-bold">{fmt(resources[k])}</span>
                  <span className={cx('num block text-[0.66rem]', net[k] < 0 ? 'text-vermilion-bright' : 'text-muted')}>{fmtSigned(net[k])}/h</span>
                </span>
              </li>
            );
          })}
        </ul>

        <div className="ml-auto flex items-center gap-2 lg:ml-0 lg:gap-3">
          <div className="flex items-center gap-1.5 rounded-[3px] border border-gold/15 bg-ink-800/60 px-2 py-1.5" title="Population of your provinces">
            <span className="font-display text-sm font-bold text-gold" aria-hidden>
              民
            </span>
            <span className="sr-only">Population: </span>
            <span className="num text-[0.86rem] font-bold">{fmtCompact(clan.population)}</span>
          </div>
          <div
            className={cx('flex items-center gap-1.5 rounded-[3px] border px-2 py-1.5', clan.army.total >= clan.army.capacity ? 'border-gold/50 bg-gold/10' : 'border-gold/15 bg-ink-800/60')}
            title="Soldiers under arms / army capacity"
          >
            <span className="font-display text-sm font-bold text-gold" aria-hidden>
              兵
            </span>
            <span className="sr-only">Army: </span>
            <span className="num text-[0.86rem] font-bold">
              {fmtCompact(clan.army.total)}
              <span className="font-normal text-muted">/{fmtCompact(clan.army.capacity)}</span>
            </span>
          </div>
          <GameClock className="hidden min-[420px]:block" />
          <Bell />
        </div>
      </div>

      {/* mobile resources */}
      <ul className="grid grid-cols-5 border-t border-gold/10 lg:hidden" aria-label="Treasury">
        {RESOURCE_KEYS.map((k) => {
          const warn = k === 'food' && (clan.starving || net.food < 0);
          return (
            <li key={k} className={cx('flex flex-col items-center px-0.5 py-1.5 leading-tight', warn && 'bg-vermilion/20')}>
              <span className="flex items-center gap-1">
                <span className={cx('font-display text-[0.82rem] font-bold', warn ? 'text-vermilion-bright' : 'text-gold')} aria-hidden>
                  {RESOURCE_INFO[k].kanji}
                </span>
                <span className="sr-only">{RESOURCE_INFO[k].name}: </span>
                <span className="num text-[0.84rem] font-bold">{fmtCompact(resources[k])}</span>
              </span>
              <span className={cx('num text-[0.62rem]', net[k] < 0 ? 'text-vermilion-bright' : 'text-muted')}>{fmtSigned(net[k])}/h</span>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between border-t border-gold/10 px-3 py-1 text-[0.68rem] text-muted min-[420px]:hidden">
        <span className="num">
          Day {world.day} · {String(world.hour).padStart(2, '0')}:00
        </span>
        <span className="num">
          next hour <Countdown to={world.nextTickAt} className="text-gold-bright" done="now" />
        </span>
      </div>

      {clan.starving ? (
        <div className="border-t border-vermilion-bright/40 bg-vermilion/30 px-3 py-1.5 text-center text-xs font-medium text-parchment-light" role="alert">
          The granaries are empty. Loyalty is falling and soldiers are deserting — raise food production or reduce your army.
        </div>
      ) : null}
      {!online ? (
        <div className="border-t border-gold/20 bg-ink-700 px-3 py-1 text-center text-xs text-gold-bright" role="status">
          Messengers cannot reach the realm. Reconnecting…
        </div>
      ) : world.behind ? (
        <div className="border-t border-gold/20 bg-ink-700 px-3 py-1 text-center text-xs text-muted" role="status">
          The chronicle is catching up on the hours that passed while the realm slept…
        </div>
      ) : null}
    </header>
  );
}

function BottomNav() {
  const pathname = usePathname();
  const { unread } = useGame();
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = NAV.filter((n) => MOBILE_PRIMARY.includes(n.href));
  const rest = NAV.filter((n) => !MOBILE_PRIMARY.includes(n.href));
  const restActive = rest.some((n) => isActive(pathname, n.href));

  useEffect(() => setMoreOpen(false), [pathname]);

  return (
    <>
      {moreOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close menu" onClick={() => setMoreOpen(false)} />
          <div className="panel absolute inset-x-0 bottom-0 animate-rise rounded-b-none bg-ink-850 p-3" style={{ paddingBottom: 'calc(76px + var(--safe-bottom))', background: 'linear-gradient(180deg,#2a241b,#15120e)' }}>
            <div className="heading-rule mb-2 px-1">More of your realm</div>
            <ul className="grid grid-cols-2 gap-2">
              {rest.map((item) => {
                const active = isActive(pathname, item.href);
                const badge = item.href === '/game/messages' && unread > 0 ? unread : null;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cx('flex min-h-[56px] items-center gap-3 rounded-[3px] border px-3', active ? 'border-gold/50 bg-gold/10' : 'border-gold/15 bg-ink-800/70')}
                    >
                      <span className={cx('seal seal-sm', active ? '' : 'seal-ink')} aria-hidden>
                        {item.kanji}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display text-[0.95rem] font-bold">{item.label}</span>
                        <span className="block truncate text-[0.68rem] text-muted">{item.purpose}</span>
                      </span>
                      {badge ? <span className="num rounded-sm bg-vermilion px-1.5 py-0.5 text-[0.65rem] font-bold">{badge > 99 ? '99+' : badge}</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-gold/25 bg-ink-950/95 backdrop-blur-md lg:hidden" style={{ paddingBottom: 'var(--safe-bottom)' }} aria-label="Main navigation">
        <ul className="grid grid-cols-5">
          {primary.map((item) => {
            const active = isActive(pathname, item.href) && !moreOpen;
            return (
              <li key={item.href}>
                <Link href={item.href} aria-current={active ? 'page' : undefined} className={cx('flex min-h-[60px] flex-col items-center justify-center gap-1', active ? 'text-gold-bright' : 'text-muted')}>
                  <span className={cx('seal seal-sm', active ? '' : 'seal-ink')} aria-hidden>
                    {item.kanji}
                  </span>
                  <span className="text-[0.66rem] font-medium tracking-wide">{item.label === 'Japan Map' ? 'Map' : item.label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen((o) => !o)}
              aria-expanded={moreOpen}
              className={cx('relative flex min-h-[60px] w-full flex-col items-center justify-center gap-1', moreOpen || restActive ? 'text-gold-bright' : 'text-muted')}
            >
              <span className={cx('seal seal-sm', moreOpen || restActive ? '' : 'seal-ink')} aria-hidden>
                他
              </span>
              <span className="text-[0.66rem] font-medium tracking-wide">More</span>
              {unread > 0 ? <span className="absolute right-[22%] top-1.5 h-2.5 w-2.5 rounded-full border border-ink-950 bg-vermilion-bright" aria-label={`${unread} unread`} /> : null}
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}

export function GameShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh lg:pl-60">
      <Sidebar />
      <ResourceHeader />
      <main className="mx-auto w-full max-w-[1500px] px-3 pb-[calc(84px+var(--safe-bottom))] pt-4 lg:px-6 lg:pb-10 lg:pt-6">{children}</main>
      <BottomNav />
    </div>
  );
}
