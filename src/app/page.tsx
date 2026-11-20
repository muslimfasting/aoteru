'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { MeResponse } from '@/game/api';
import { BUILDINGS, BUILDING_TYPES, GAME_NAME, GAME_SUBTITLE, GAME_TAGLINE, UNITS, UNIT_TYPES } from '@/game/config';
import { MAP_DECOR, MAP_SIZE, PROVINCES, REGIONS } from '@/game/map';
import { ROLE_DEFS } from '@/game/clan';
import { PILLARS, PILLAR_DEFS } from '@/game/pillars';
import { Brand } from '@/components/Brand';
import { apiGet } from '@/lib/api';

import { Glyph } from '@/components/icons';
const TINTS = ['#9b2d30', '#31487a', '#2f6b4f', '#b8862f', '#6a4a85'];

function MapEngraving() {
  const pts = (poly: readonly (readonly [number, number])[]) => poly.map((p) => `${p[0]},${p[1]}`).join(' ');
  return (
    <svg viewBox={`0 0 ${MAP_SIZE.width} ${MAP_SIZE.height}`} className="h-full w-full" role="img" aria-label="Stylised map of the Kansai provinces">
      <polygon points={pts(MAP_DECOR.land)} fill="#2a241b" stroke="#c8a24a" strokeOpacity="0.25" strokeWidth="2" />
      {PROVINCES.map((p, i) => (
        <g key={p.code}>
          <polygon points={pts(p.polygon)} fill="#e6d9ba" stroke="#17130e" strokeWidth="3.5" strokeLinejoin="round" />
          <polygon points={pts(p.polygon)} fill={TINTS[i % TINTS.length]} fillOpacity={i % 3 === 0 ? 0.55 : i % 3 === 1 ? 0.25 : 0} />
          <text x={p.label[0]} y={p.label[1]} textAnchor="middle" fontFamily="var(--font-display)" fontSize="36" fontWeight="700" fill="#17130e" stroke="#f6ecd3" strokeWidth="5" paintOrder="stroke">
            <Glyph k={p.kanji} />
          </text>
          <text x={p.label[0]} y={p.label[1] + 20} textAnchor="middle" fontFamily="var(--font-display)" fontSize="14" fontWeight="700" letterSpacing="2.5" fill="#17130e" stroke="#f6ecd3" strokeWidth="4" paintOrder="stroke">
            {p.name.toUpperCase()}
          </text>
        </g>
      ))}
      <polygon points={pts(MAP_DECOR.lakeBiwa)} fill="#1d2c33" stroke="#17130e" strokeWidth="2.5" />
    </svg>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  // A signed-in player goes straight to the game.
  useEffect(() => {
    let cancelled = false;
    apiGet<MeResponse>('/api/player/me')
      .then(() => {
        // The game itself sends a player without a nation to nation discovery.
        if (!cancelled) router.replace('/game');
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4">
        <Brand href="/" />
        <nav className="flex items-center gap-2">
          <Link href="/login" className="btn btn-ghost">
            Sign in
          </Link>
          <Link href="/register" className="btn btn-primary hidden sm:inline-flex">
            Begin your rise
          </Link>
        </nav>
      </header>

      <main>
        {/* hero */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-8 px-4 pb-10 pt-6 lg:grid-cols-[1.05fr_1fr] lg:gap-12 lg:pb-16 lg:pt-12">
          <div className="relative">
            <p className="heading-rule mb-4 max-w-xs">A chronicle of the divided country</p>
            <h1 className="font-display text-[3.3rem] font-extrabold leading-[0.95] tracking-[0.06em] text-parchment sm:text-7xl">
              {GAME_NAME.toUpperCase()}
              <span className="mt-3 block text-xl font-bold tracking-[0.3em] text-gold sm:text-2xl">{GAME_SUBTITLE.toUpperCase()}</span>
            </h1>
            <p className="mt-6 font-display text-xl leading-relaxed text-parchment/90 sm:text-2xl">{GAME_TAGLINE}</p>
            <p className="mt-4 max-w-xl leading-relaxed text-muted">
              Japan fell, and has rebuilt itself to the age of steam and telegraph — but not as one country. Rival governments hold the provinces, each claiming to speak for the whole. Enter the service of a nation, or found one: rise from{' '}
              {ROLE_DEFS.recruit.name} to {ROLE_DEFS.leader.name}, fill its treasury, train its armies, read its rivals — and decide together, one border at a time, who will reunify the country. The strongest nation does not always win;
              the smartest does. One shared world. It keeps turning while you sleep.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/register" className="btn btn-primary !min-h-[52px] !px-7 text-base">
                Found or join a nation
              </Link>
              <Link href="/login" className="btn !min-h-[52px] !px-6 text-base">
                Return to your post
              </Link>
            </div>
            {checking ? <p className="mt-3 text-xs text-faint">Checking your papers…</p> : <p className="mt-3 text-xs text-faint">Free to play in your browser on desktop, tablet and phone. No pay-to-win.</p>}
          </div>

          <div className="relative">
            <div className="vertical-text pointer-events-none absolute -left-2 top-2 z-10 select-none rounded-sm bg-vermilion px-1.5 py-3 font-display text-lg font-bold text-parchment-light shadow-lg sm:-left-5" aria-hidden>
              <Glyph k="天下統一" />
            </div>
            <div className="paper aspect-[1000/940] w-full overflow-hidden p-2 sm:p-3">
              <div className="h-full w-full overflow-hidden border border-ink-900/60 bg-[#1d2c33]">
                <MapEngraving />
              </div>
            </div>
            <p className="mt-2 text-center font-display text-sm italic text-muted">Kansai, the home provinces — where the first world begins.</p>
          </div>
        </section>

        {/* five pillars */}
        <section className="border-y border-gold/15 bg-ink-950/50">
          <div className="mx-auto w-full max-w-6xl px-4 py-10 lg:py-14">
            <h2 className="text-center font-display text-3xl font-extrabold">The Five Pillars</h2>
            <p className="mx-auto mt-2 max-w-2xl text-center text-muted">Every official grows their own. Nobody can master them all — so a government needs someone to command its armies, someone to keep its treasury and someone to run its spies, and what you choose to become is what your nation can count on.</p>
            <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {PILLARS.map((id) => {
                const p = PILLAR_DEFS[id];
                return (
                  <li key={id} className="panel p-4 text-center">
                    <span className="seal seal-lg mx-auto" aria-hidden>
                      <Glyph k={p.kanji} />
                    </span>
                    <h3 className="mt-3 font-display text-lg font-bold">{p.name}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{p.purpose}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* what you do */}
        <section className="mx-auto w-full max-w-6xl px-4 py-10 lg:py-14">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Feature kanji="clan" title="Serve together">
              Land, armies and the National Treasury belong to the nation. Officials pay in from their own purse, rise through the ranks, and sit in the cabinet that carries each pillar for everyone.
            </Feature>
            <Feature kanji="城" title="Rule">
              Raise {BUILDING_TYPES.map((b) => BUILDINGS[b].name.toLowerCase()).join(', ')}. Balance gold, food, wood, stone, iron and the people themselves — a hungry province does not stay loyal.
            </Feature>
            <Feature kanji="軍" title="Conquer">
              Muster {UNIT_TYPES.map((u) => UNITS[u].name.toLowerCase()).join(', ')}. Terrain, weather, walls and morale decide each battle, resolved on the server and written up round by round.
            </Feature>
            <Feature kanji="謀" title="Outwit">
              Scout before you strike, declare war when the odds are yours, make peace when they are not. Every other flag on the map is another nation of players — or a rival government with plans of its own.
            </Feature>
          </div>

          <div className="paper mt-8 p-5 sm:p-7">
            <h2 className="font-display text-2xl font-extrabold">The road to reunification</h2>
            <p className="mt-2 max-w-3xl leading-relaxed">
              Japan is divided into seven regions. This first world opens one of them; the rest of the map waits beyond its borders.
            </p>
            <ul className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
              {REGIONS.map((r) => (
                <li key={r.id} className="flex items-baseline gap-2 border-b border-ink-900/15 pb-1.5">
                  <span className="font-display text-lg font-bold text-vermilion-deep"><Glyph k={r.kanji} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="font-display font-bold">{r.name}</span>
                    <span className="block text-xs text-ink-700">{r.identity}</span>
                  </span>
                  {r.playable ? <span className="chip chip-red">Open</span> : <span className="text-xs text-ink-600">sealed</span>}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-gold/15 px-4 py-6 text-center text-xs text-faint">
        {GAME_NAME}: {GAME_SUBTITLE} — first playable prototype. An original work of fiction set in an imagined Japan; its nations and characters are invented.
      </footer>
    </div>
  );
}

function Feature({ kanji, title, children }: { kanji: string; title: string; children: React.ReactNode }) {
  return (
    <article className="panel p-5">
      <div className="flex items-center gap-3">
        <span className="seal" aria-hidden>
          <Glyph k={kanji} />
        </span>
        <h3 className="font-display text-xl font-bold">{title}</h3>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-parchment/80">{children}</p>
    </article>
  );
}
