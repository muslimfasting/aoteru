'use client';

/**
 * Persistent game chrome: resource header, desktop sidebar, mobile bottom
 * navigation. Every gameplay screen is reachable on every screen size.
 *
 * A member of a nation sees the shared treasury in the header and their own
 * purse behind the pouch button. A player without a nation sees their purse and
 * only the screens that need no nation.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RESOURCE_INFO, RESOURCE_KEYS } from '@/game/config';
import { useSession } from '@/lib/game-context';
import { cx, fmt, fmtCompact, fmtSigned, hourName } from '@/lib/format';
import { Banner } from './Banner';
import { Brand } from './Brand';
import { ClanTag } from './clan';
import { Portrait } from './Portrait';
import { Countdown, Dialog } from './ui';

import { Icon, type IconName } from '@/components/icons';
interface NavItem {
  href: string;
  label: string;
  short?: string;
  icon: IconName;
  purpose: string;
  /** Only shown to members of an active nation. */
  clanOnly?: boolean;
}

const BASE_NAV: NavItem[] = [
  { href: '/game', label: 'Overview', icon: 'overview', purpose: 'State of the nation', clanOnly: true },
  { href: '/game/map', label: 'Japan Map', short: 'Map', icon: 'map', purpose: 'Territory' },
  { href: '/game/castle', label: 'Castle', icon: 'castle', purpose: 'Provinces and buildings', clanOnly: true },
  { href: '/game/military', label: 'Military', icon: 'military', purpose: 'Army and warfare', clanOnly: true },
  { href: '/game/war', label: 'War Council', short: 'War', icon: 'war', purpose: 'Plans and strategy', clanOnly: true },
  { href: '/game/clan', label: 'Nation', icon: 'clan', purpose: 'Government and treasury' },
  { href: '/game/pillars', label: 'Five Pillars', short: 'Pillars', icon: 'pillars', purpose: 'Your own progression' },
  { href: '/game/diplomacy', label: 'Diplomacy', icon: 'diplomacy', purpose: 'War and peace', clanOnly: true },
  { href: '/game/intel', label: 'Intelligence', icon: 'intel', purpose: 'Scouts and spies', clanOnly: true },
  { href: '/game/ranking', label: 'Ranking', icon: 'ranking', purpose: 'Nations and players' },
  { href: '/game/messages', label: 'Messages', icon: 'messages', purpose: 'Reports and chat' },
  { href: '/game/settings', label: 'Settings', icon: 'settings', purpose: 'Profile and world' },
];

interface Nav {
  items: NavItem[];
  /** Shown directly in the mobile bar; the rest sit behind "More". */
  primary: NavItem[];
  rest: NavItem[];
  badge: (item: NavItem) => number | null;
}

function useNav(): Nav {
  const { clan, hasClan, unread, unreadMessages, pendingInvitations } = useSession();
  const items = BASE_NAV.filter((n) => hasClan || !n.clanOnly).map((n) =>
    n.href === '/game/clan' && !clan ? { ...n, href: '/game/clans', label: 'Nations', purpose: 'Find or found a nation' } : n,
  );
  const order = hasClan ? ['/game', '/game/map', '/game/castle', '/game/military', '/game/clan'] : [clan ? '/game/clan' : '/game/clans', '/game/map', '/game/messages', '/game/pillars', '/game/ranking'];
  const primary = order.map((href) => items.find((n) => n.href === href)).filter((n): n is NavItem => !!n);
  const rest = items.filter((n) => !primary.includes(n));
  const badge = (item: NavItem) => {
    const n = item.href === '/game/messages' ? unread + unreadMessages : item.href === '/game/clans' ? pendingInvitations : 0;
    return n > 0 ? n : null;
  };
  return { items, primary, rest, badge };
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/game') return pathname === '/game';
  if (href === '/game/military') return pathname.startsWith('/game/military') || pathname.startsWith('/game/battles');
  if (href === '/game/clan' || href === '/game/clans') return pathname.startsWith('/game/clan') || pathname.startsWith('/game/players');
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Count({ n, className }: { n: number; className?: string }) {
  return <span className={cx('num rounded-sm bg-vermilion px-1.5 py-0.5 text-[0.65rem] font-bold text-parchment-light', className)}>{n > 99 ? '99+' : n}</span>;
}

function Sidebar() {
  const pathname = usePathname();
  const { player, clan, membership, world, online } = useSession();
  const nav = useNav();
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-gold/20 bg-ink-950/90 backdrop-blur lg:flex">
      <div className="border-b border-gold/15 px-5 py-4">
        <Brand />
      </div>
      {clan ? (
        <Link href="/game/clan" className="flex items-center gap-3 border-b border-gold/15 px-5 py-3.5 transition-colors hover:bg-parchment/5">
          <Banner color={clan.banner.color} mon={clan.banner.mon} size={52} title={`Flag of ${clan.name}`} />
          <div className="min-w-0">
            <div className="truncate font-display text-base font-bold leading-tight">
              {clan.name} <ClanTag tag={clan.tag} />
            </div>
            <div className="truncate text-xs text-muted">
              {player.nickname} · {membership?.roleName ?? 'Official'}
            </div>
            <div className="mt-1 text-[0.68rem] uppercase tracking-wider text-gold">
              {clan.status === 'active' ? (
                <>
                  Rank {clan.rank} · {clan.provinceCount} {clan.provinceCount === 1 ? 'province' : 'provinces'}
                </>
              ) : (
                'Fallen — no land'
              )}
            </div>
          </div>
        </Link>
      ) : (
        <Link href="/game/clans" className="flex items-center gap-3 border-b border-gold/15 px-5 py-3.5 transition-colors hover:bg-parchment/5">
          <Portrait id={player.portrait} size={52} />
          <div className="min-w-0">
            <div className="truncate font-display text-base font-bold leading-tight">{player.nickname}</div>
            <div className="truncate text-xs text-muted">Without a nation</div>
            <div className="mt-1 text-[0.68rem] uppercase tracking-wider text-gold">Find or found one</div>
          </div>
        </Link>
      )}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3" aria-label="Main navigation">
        <ul className="space-y-0.5">
          {nav.items.map((item) => {
            const active = isActive(pathname, item.href);
            const badge = nav.badge(item);
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
                    <Icon name={item.icon} />
                  </span>
                  <span className="flex-1 font-display text-[0.98rem] font-bold tracking-wide">{item.label}</span>
                  {badge ? <Count n={badge} /> : null}
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
  const { world } = useSession();
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
  const { unread } = useSession();
  return (
    <Link
      href="/game/messages"
      className="relative grid h-11 w-11 shrink-0 place-items-center rounded-[3px] border border-gold/30 bg-gold/5 transition-colors hover:bg-gold/15"
      aria-label={unread > 0 ? `${unread} unread reports` : 'Reports'}
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

/** The player's own purse, kept apart from the nation treasury. */
function PurseButton() {
  const { purse, personal, clan } = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-11 shrink-0 items-center gap-1.5 rounded-[3px] border border-gold/30 bg-gold/5 px-2 transition-colors hover:bg-gold/15"
        aria-label={`Your purse: ${fmt(purse.gold)} gold. Open purse.`}
        title="Your own purse — separate from the National Treasury"
      >
        <span className="text-gold" aria-hidden>
          <Icon name="purse" />
        </span>
        <span className="leading-tight">
          <span className="hidden text-left text-[0.6rem] font-medium uppercase tracking-wider text-muted xl:block">Purse</span>
          <span className="num block text-[0.86rem] font-bold">{fmtCompact(purse.gold)}</span>
        </span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Your purse" icon="purse">
        <p className="text-sm text-muted">These are yours alone. They stay with you if you change nation. The National Treasury is filled by what officials pay in.</p>
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {RESOURCE_KEYS.map((k) => (
            <li key={k} className="panel-flat flex items-center gap-2 px-2.5 py-2">
              <span className="seal seal-sm seal-ink" aria-hidden>
                <Icon name={k} />
              </span>
              <span className="leading-tight">
                <span className="block text-[0.62rem] uppercase tracking-wider text-muted">{RESOURCE_INFO[k].name}</span>
                <span className="num block font-bold">{fmt(purse[k])}</span>
                <span className={cx('num block text-[0.66rem]', personal.incomeActive ? 'text-jade' : 'text-faint')}>+{fmt(personal.residenceIncome[k])}/h</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Your residence (level {personal.residenceLevel}) pays this income every game hour
          {personal.incomeActive ? '.' : clan ? ' — but only while your nation holds land.' : ' — but only once you belong to a nation that holds land.'}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/game/pillars#residence" className="btn btn-sm">
            Residence and training
          </Link>
          {clan ? (
            <Link href="/game/clan?tab=treasury" className="btn btn-sm btn-gold">
              Contribute to the nation
            </Link>
          ) : (
            <Link href="/game/clans" className="btn btn-sm btn-gold">
              Find a nation
            </Link>
          )}
        </div>
      </Dialog>
    </>
  );
}

function ResourceHeader() {
  const { clan, hasClan, resources, purse, personal, world, online } = useSession();
  // Members see the shared treasury; a player without a nation sees their own purse.
  const shared = hasClan && clan && resources ? { amounts: resources, net: clan.income.net, starving: clan.starving } : null;
  const amounts = shared ? shared.amounts : purse;
  const label = shared ? 'National Treasury' : 'Your purse';
  const rate = (k: (typeof RESOURCE_KEYS)[number]) => (shared ? shared.net[k] : personal.incomeActive ? personal.residenceIncome[k] : 0);
  return (
    <header className="sticky top-0 z-30 border-b border-gold/20 bg-ink-950/92 backdrop-blur-md">
      {/* top row */}
      <div className="flex items-center gap-2 px-3 py-2 lg:gap-3 lg:px-6 xl:gap-4">
        <div className="lg:hidden">
          <Brand compact />
        </div>

        {/* desktop resources */}
        <div className="hidden w-[3.4rem] shrink-0 text-[0.6rem] font-medium uppercase leading-tight tracking-wider text-muted xl:block" aria-hidden>
          {shared ? (
            <>
              National
              <br />
              Treasury
            </>
          ) : (
            <>
              Your
              <br />
              purse
            </>
          )}
        </div>
        <ul className="hidden flex-1 items-center gap-1.5 lg:flex xl:gap-2.5" aria-label={label}>
          {RESOURCE_KEYS.map((k) => {
            const warn = !!shared && k === 'food' && (shared.starving || shared.net.food < 0);
            return (
              <li
                key={k}
                className={cx('flex items-center gap-2 rounded-[3px] border px-2 py-1.5 xl:px-2.5', warn ? 'border-vermilion-bright/60 bg-vermilion/15' : 'border-gold/15 bg-ink-800/60')}
                title={`${label}: ${RESOURCE_INFO[k].name} — ${RESOURCE_INFO[k].purpose}`}
              >
                <span className={cx('seal seal-sm', warn ? '' : 'seal-ink')} aria-hidden>
                  <Icon name={k} />
                </span>
                <span className="leading-tight">
                  <span className="block text-[0.6rem] font-medium uppercase tracking-wider text-muted">{RESOURCE_INFO[k].name}</span>
                  <span className="num block text-[0.95rem] font-bold">{fmt(amounts[k])}</span>
                  <span className={cx('num block text-[0.66rem]', rate(k) < 0 ? 'text-vermilion-bright' : 'text-muted')}>{fmtSigned(rate(k))}/h</span>
                </span>
              </li>
            );
          })}
        </ul>

        <div className="ml-auto flex items-center gap-2 lg:ml-0 lg:gap-2.5">
          {shared && clan ? (
            <>
              <div className="hidden items-center gap-1.5 rounded-[3px] border border-gold/15 bg-ink-800/60 px-2 py-1.5 min-[400px]:flex" title="Population of your nation's provinces">
                <span className="font-display text-sm font-bold text-gold" aria-hidden>
                  <Icon name="people" />
                </span>
                <span className="sr-only">Population: </span>
                <span className="num text-[0.86rem] font-bold">{fmtCompact(clan.population)}</span>
              </div>
              <div
                className={cx('flex items-center gap-1.5 rounded-[3px] border px-2 py-1.5', clan.army.total >= clan.army.capacity ? 'border-gold/50 bg-gold/10' : 'border-gold/15 bg-ink-800/60')}
                title="Soldiers under arms / army capacity"
              >
                <span className="font-display text-sm font-bold text-gold" aria-hidden>
                  <Icon name="army" />
                </span>
                <span className="sr-only">Army: </span>
                <span className="num text-[0.86rem] font-bold">
                  {fmtCompact(clan.army.total)}
                  <span className="font-normal text-muted">/{fmtCompact(clan.army.capacity)}</span>
                </span>
              </div>
              <PurseButton />
            </>
          ) : (
            <Link href="/game/pillars#residence" className="hidden h-11 items-center gap-1.5 rounded-[3px] border border-gold/30 bg-gold/5 px-2.5 text-sm transition-colors hover:bg-gold/15 min-[400px]:flex">
              <span className="text-gold" aria-hidden>
                <Icon name="home" />
              </span>
              Residence {personal.residenceLevel}
            </Link>
          )}
          <GameClock className="hidden min-[480px]:block" />
          <Bell />
        </div>
      </div>

      {/* mobile resources */}
      <div className="flex items-center gap-2 border-t border-gold/10 px-3 pt-1 text-[0.6rem] uppercase tracking-wider text-faint lg:hidden">
        <span>{label}</span>
        <span className="h-px flex-1 bg-gold/10" />
      </div>
      <ul className="grid grid-cols-5 lg:hidden" aria-label={label}>
        {RESOURCE_KEYS.map((k) => {
          const warn = !!shared && k === 'food' && (shared.starving || shared.net.food < 0);
          return (
            <li key={k} className={cx('flex flex-col items-center px-0.5 pb-1.5 pt-0.5 leading-tight', warn && 'bg-vermilion/20')}>
              <span className="flex items-center gap-1">
                <span className={cx('font-display text-[0.82rem] font-bold', warn ? 'text-vermilion-bright' : 'text-gold')} aria-hidden>
                  <Icon name={k} />
                </span>
                <span className="sr-only">{RESOURCE_INFO[k].name}: </span>
                <span className="num text-[0.84rem] font-bold">{fmtCompact(amounts[k])}</span>
              </span>
              <span className={cx('num text-[0.6rem]', rate(k) < 0 ? 'text-vermilion-bright' : 'text-muted')}>
                {RESOURCE_INFO[k].name} {fmtSigned(rate(k))}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between border-t border-gold/10 px-3 py-1 text-[0.68rem] text-muted min-[480px]:hidden">
        <span className="num">
          Day {world.day} · {String(world.hour).padStart(2, '0')}:00
        </span>
        <span className="num">
          next hour <Countdown to={world.nextTickAt} className="text-gold-bright" done="now" />
        </span>
      </div>

      {shared?.starving ? (
        <div className="border-t border-vermilion-bright/40 bg-vermilion/30 px-3 py-1.5 text-center text-xs font-medium text-parchment-light" role="alert">
          The granaries are empty. Loyalty is falling and soldiers are deserting — raise food production or reduce the army.
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
  const nav = useNav();
  const [moreOpen, setMoreOpen] = useState(false);
  // A single leftover screen gets its own slot instead of hiding behind "More".
  const inline = nav.rest.length === 1 ? [...nav.primary, ...nav.rest] : nav.primary;
  const rest = nav.rest.length === 1 ? [] : nav.rest;
  const restActive = rest.some((n) => isActive(pathname, n.href));
  const restBadge = rest.reduce((sum, n) => sum + (nav.badge(n) ?? 0), 0);

  useEffect(() => setMoreOpen(false), [pathname]);

  return (
    <>
      {moreOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close menu" onClick={() => setMoreOpen(false)} />
          <div className="panel absolute inset-x-0 bottom-0 animate-rise rounded-b-none bg-ink-850 p-3" style={{ paddingBottom: 'calc(76px + var(--safe-bottom))', background: 'linear-gradient(180deg,#2a241b,#15120e)' }}>
            <div className="heading-rule mb-2 px-1">More</div>
            <ul className="grid grid-cols-2 gap-2">
              {rest.map((item) => {
                const active = isActive(pathname, item.href);
                const badge = nav.badge(item);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cx('flex min-h-[56px] items-center gap-3 rounded-[3px] border px-3', active ? 'border-gold/50 bg-gold/10' : 'border-gold/15 bg-ink-800/70')}
                    >
                      <span className={cx('seal seal-sm', active ? '' : 'seal-ink')} aria-hidden>
                        <Icon name={item.icon} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display text-[0.95rem] font-bold">{item.label}</span>
                        <span className="block truncate text-[0.68rem] text-muted">{item.purpose}</span>
                      </span>
                      {badge ? <Count n={badge} /> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-gold/25 bg-ink-950/95 backdrop-blur-md lg:hidden" style={{ paddingBottom: 'var(--safe-bottom)' }} aria-label="Main navigation">
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${inline.length + (rest.length ? 1 : 0)}, minmax(0, 1fr))` }}>
          {inline.map((item) => {
            const active = isActive(pathname, item.href) && !moreOpen;
            const badge = nav.badge(item);
            return (
              <li key={item.href}>
                <Link href={item.href} aria-current={active ? 'page' : undefined} className={cx('relative flex min-h-[60px] flex-col items-center justify-center gap-1', active ? 'text-gold-bright' : 'text-muted')}>
                  <span className={cx('seal seal-sm', active ? '' : 'seal-ink')} aria-hidden>
                    <Icon name={item.icon} />
                  </span>
                  <span className="text-[0.64rem] font-medium tracking-wide">{item.short ?? item.label}</span>
                  {badge ? <span className="absolute right-[18%] top-1.5 h-2.5 w-2.5 rounded-full border border-ink-950 bg-vermilion-bright" aria-label={`${badge} unread`} /> : null}
                </Link>
              </li>
            );
          })}
          {rest.length ? (
            <li>
              <button
                type="button"
                onClick={() => setMoreOpen((o) => !o)}
                aria-expanded={moreOpen}
                className={cx('relative flex min-h-[60px] w-full flex-col items-center justify-center gap-1', moreOpen || restActive ? 'text-gold-bright' : 'text-muted')}
              >
                <span className={cx('seal seal-sm', moreOpen || restActive ? '' : 'seal-ink')} aria-hidden>
                  <Icon name="more" />
                </span>
                <span className="text-[0.64rem] font-medium tracking-wide">More</span>
                {restBadge > 0 ? <span className="absolute right-[18%] top-1.5 h-2.5 w-2.5 rounded-full border border-ink-950 bg-vermilion-bright" aria-label={`${restBadge} unread`} /> : null}
              </button>
            </li>
          ) : null}
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
