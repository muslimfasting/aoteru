'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { WorldMapResponse } from '@/game/api';
import { MonBadge } from '@/components/Banner';
import { MarchDialog } from '@/components/MarchDialog';
import { ProvincePanel } from '@/components/ProvincePanel';
import { Countdown, ErrorState, LoadingState } from '@/components/ui';
import { WorldMap } from '@/components/WorldMap';
import { EVENTS } from '@/lib/events';
import { useApi, useIsDesktop } from '@/lib/hooks';

import { Glyph } from '@/components/icons';
export default function MapPage() {
  const map = useApi<WorldMapResponse>('/api/world/map', EVENTS.map);
  const [selected, setSelected] = useState<string | null>(null);
  const [march, setMarch] = useState<{ sourceId?: string; targetId?: string } | null>(null);
  const isDesktop = useIsDesktop();

  if (map.error && !map.data) return <ErrorState message={map.error.message} onRetry={() => void map.refresh()} />;
  if (!map.data) return <LoadingState label="Unrolling the map of Kansai…" />;
  const data = map.data;

  const panel = selected ? (
    <ProvincePanel key={selected} provinceId={selected} clans={data.clans} onClose={() => setSelected(null)} onMarch={(opts) => setMarch(opts)} />
  ) : null;

  return (
    <div className="-mx-3 -mt-4 lg:mx-0 lg:mt-0">
      <h1 className="sr-only">Map of Japan — Kansai</h1>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_390px]">
        <div className="relative h-[calc(100dvh-13.4rem-var(--safe-bottom))] min-h-[340px] min-[420px]:h-[calc(100dvh-12rem-var(--safe-bottom))] lg:h-[calc(100dvh-8.2rem)] lg:overflow-hidden lg:rounded-[4px] lg:border lg:border-gold/25">
          <WorldMap provinces={data.provinces} clans={data.clans} movements={data.movements} selectedId={selected} onSelect={setSelected} focusY={isDesktop ? undefined : 0.2} />
          {!selected ? (
            <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-3 lg:hidden">
              <span className="rounded-sm border border-gold/30 bg-ink-950/85 px-3 py-1.5 text-xs text-parchment/90">Tap a province · drag to pan · pinch to zoom</span>
            </div>
          ) : null}
        </div>

        {/* desktop side panel */}
        <aside className="panel hidden min-h-0 overflow-y-auto lg:block lg:h-[calc(100dvh-8.2rem)]">
          {isDesktop && panel ? panel : <RealmSummary data={data} onSelect={setSelected} />}
        </aside>
      </div>

      {/* mobile bottom sheet */}
      {!isDesktop && panel ? (
        <div
          className="panel fixed inset-x-0 z-40 max-h-[50dvh] animate-rise overflow-y-auto rounded-b-none border-x-0 lg:hidden"
          style={{ bottom: 'calc(60px + var(--safe-bottom))', background: 'linear-gradient(180deg,#2a241b,#17130e)' }}
          role="dialog"
          aria-label="Province details"
        >
          <div className="sticky top-0 z-10 flex justify-center bg-[#2a241b] pb-1 pt-2">
            <span className="h-1 w-10 rounded-full bg-gold/40" />
          </div>
          {panel}
        </div>
      ) : null}

      <MarchDialog open={march !== null} onClose={() => setMarch(null)} sourceId={march?.sourceId} targetId={march?.targetId} />
    </div>
  );
}

function RealmSummary({ data, onSelect }: { data: WorldMapResponse; onSelect: (id: string) => void }) {
  const provinceName = (id: string) => data.provinces.find((p) => p.id === id)?.name ?? '—';
  const clans = [...data.clans].filter((c) => c.status === 'active').sort((a, b) => b.provinceCount - a.provinceCount || b.score - a.score);
  const unclaimed = data.provinces.filter((p) => !p.ownerClanId);
  return (
    <div className="space-y-5 p-4">
      <div>
        <h2 className="font-display text-xl font-extrabold">The realm of Kansai</h2>
        <p className="mt-1 text-sm text-muted">Select a province to see who holds it, what it yields and what can be done there. Drag to move the map, scroll or pinch to zoom.</p>
      </div>

      <section>
        <div className="heading-rule mb-2">Clans</div>
        <ul className="space-y-1.5">
          {clans.map((c) => (
            <li key={c.id} className="flex items-center gap-2.5">
              <MonBadge color={c.banner.color} mon={c.banner.mon} size={28} />
              <span className="min-w-0 flex-1 truncate font-display font-bold">
                {c.name}
                {c.id === data.viewerClanId ? <span className="ml-1.5 font-body text-xs font-normal text-gold">you</span> : null}
              </span>
              <span className="num text-sm text-muted">
                {c.provinceCount} {c.provinceCount === 1 ? 'province' : 'provinces'}
              </span>
            </li>
          ))}
          <li className="flex items-center gap-2.5 text-muted">
            <span className="grid h-7 w-7 place-items-center rounded-full border border-dashed border-muted/60 text-xs">—</span>
            <span className="flex-1">Unclaimed</span>
            <span className="num text-sm">{unclaimed.length}</span>
          </li>
        </ul>
      </section>

      {data.battles.length > 0 ? (
        <section>
          <div className="heading-rule mb-2">Battles being fought</div>
          <ul className="space-y-1.5">
            {data.battles.map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => onSelect(b.provinceId)} className="panel-flat flex min-h-[44px] w-full items-center gap-2 px-3 text-left hover:border-gold/40">
                  <span className="seal seal-sm" aria-hidden>
                    <Glyph k="戦" />
                  </span>
                  <span className="flex-1 truncate font-display font-bold">{provinceName(b.provinceId)}</span>
                  <Countdown to={b.resolvesAt} className="text-sm text-gold-bright" done="resolving…" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.movements.length > 0 ? (
        <section>
          <div className="heading-rule mb-2">Armies on the march</div>
          <ul className="space-y-1.5">
            {data.movements.map((m) => {
              const clan = data.clans.find((c) => c.id === m.clanId);
              return (
                <li key={m.id}>
                  <button type="button" onClick={() => onSelect(m.toProvinceId)} className="panel-flat flex min-h-[44px] w-full items-center gap-2 px-3 text-left hover:border-gold/40">
                    {clan ? <MonBadge color={clan.banner.color} mon={clan.banner.mon} size={22} /> : null}
                    <span className="min-w-0 flex-1 truncate text-sm">
                      <span className="font-bold">{m.own ? 'Your army' : (clan?.name ?? 'An army')}</span> → {provinceName(m.toProvinceId)}
                    </span>
                    <span className={m.intent === 'attack' ? 'chip chip-red' : 'chip chip-muted'}>{m.intent === 'attack' ? 'attack' : m.intent === 'return' ? 'returning' : 'move'}</span>
                    {m.status === 'besieging' ? <span className="text-sm text-vermilion-bright">fighting</span> : <Countdown to={m.arrivesAt} className="text-sm text-gold-bright" done="arriving" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {data.activeEvents.length > 0 ? (
        <section>
          <div className="heading-rule mb-2">Events in force</div>
          <ul className="space-y-1.5 text-sm">
            {data.activeEvents.map((e) => (
              <li key={e.id} className="panel-flat p-2.5">
                <span className="font-display font-bold">{e.title}</span>
                <span className="block text-muted">{e.description}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-xs text-muted">
        Hold {data.world.hegemonyProvinces} provinces to be proclaimed hegemon of Kansai. See the{' '}
        <Link href="/game/ranking" className="tap-link text-gold">
          ranking
        </Link>
        .
      </p>
    </div>
  );
}
