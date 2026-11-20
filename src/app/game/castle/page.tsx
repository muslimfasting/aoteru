'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import type { BuildingDTO, ProvinceDetailResponse, ProvinceSummaryDTO, WorldMapResponse } from '@/game/api';
import { BUILDINGS, RESOURCE_INFO, RESOURCE_KEYS, armyPower, bannerHex, emptyBuildingLevels, totalUnits } from '@/game/config';
import { CityView } from '@/components/CityView';
import { ActionButton, Bar, CostRow, Countdown, DurationText, EmptyState, ErrorState, LoadingState, PageHeader, Panel, TimedProgress, UnitsRow } from '@/components/ui';
import { apiPost } from '@/lib/api';
import { useNow } from '@/lib/clock';
import { EVENTS } from '@/lib/events';
import { cx, fmt, missingResources } from '@/lib/format';
import { useGame } from '@/lib/game-context';
import { useAction, useApi } from '@/lib/hooks';

import { Icon } from '@/components/icons';
export default function CastlePage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <CastleScreen />
    </Suspense>
  );
}

function CastleScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const { clan } = useGame();
  const map = useApi<WorldMapResponse>('/api/world/map', EVENTS.map);
  const own = map.data?.provinces.filter((p) => p.relation === 'own') ?? [];
  const requested = params.get('province');
  const selectedId = own.find((p) => p.id === requested)?.id ?? own.find((p) => p.id === clan.capitalProvinceId)?.id ?? own[0]?.id ?? null;

  // Keep the URL in step with the province on screen so it can be shared or reloaded.
  useEffect(() => {
    if (selectedId && requested !== selectedId && map.data) router.replace(`/game/castle?province=${selectedId}`, { scroll: false });
  }, [selectedId, requested, map.data, router]);

  return (
    <div>
      <PageHeader kanji="城" title="Castle" subtitle="Raise buildings, tend your people, and keep the province loyal." />
      {map.error && !map.data ? (
        <ErrorState message={map.error.message} onRetry={() => void map.refresh()} />
      ) : !map.data ? (
        <LoadingState />
      ) : own.length === 0 || !selectedId ? (
        <EmptyState title="You hold no province">Without land there is no castle to manage.</EmptyState>
      ) : (
        <>
          <ProvinceSwitcher provinces={own} selectedId={selectedId} onSelect={(id) => router.replace(`/game/castle?province=${id}`, { scroll: false })} />
          <ProvinceManagement key={selectedId} provinceId={selectedId} />
        </>
      )}
    </div>
  );
}

function ProvinceSwitcher({ provinces, selectedId, onSelect }: { provinces: ProvinceSummaryDTO[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <div className="-mx-3 mb-4 flex gap-2 overflow-x-auto px-3 pb-1 lg:mx-0 lg:px-0" role="tablist" aria-label="Your provinces">
      {provinces.map((p) => {
        const active = p.id === selectedId;
        return (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(p.id)}
            className={cx(
              'flex min-h-[52px] shrink-0 items-center gap-2.5 rounded-[3px] border px-3 text-left transition-colors',
              active ? 'border-gold bg-gold/15' : 'border-gold/20 bg-ink-800/60 hover:border-gold/50',
            )}
          >
            <span className={cx('grid h-9 w-9 place-items-center font-display text-base font-bold', active ? 'paper' : 'border border-gold/25 text-gold')}>{p.kanji}</span>
            <span className="leading-tight">
              <span className="block font-display font-bold">{p.name}</span>
              <span className="block text-[0.68rem] text-muted">
                Castle Lv {p.castleLevel}
                {p.isCapital ? ' · capital' : ''}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ProvinceManagement({ provinceId }: { provinceId: string }) {
  const state = useApi<ProvinceDetailResponse>(`/api/provinces/${provinceId}`, EVENTS.province);
  const { resources, clan, world } = useGame();
  const build = useAction();
  const festival = useAction();
  const now = useNow();

  if (state.error && !state.data) return <ErrorState message={state.error.message} onRetry={() => void state.refresh()} />;
  if (!state.data) return <LoadingState label="Summoning the castle steward…" />;
  const { province, own } = state.data;
  if (!own) return <EmptyState title={`${province.name} is no longer yours`}>Another banner flies over this castle.</EmptyState>;

  const upgrade = (b: BuildingDTO) =>
    build.run(
      async () => {
        const res = await apiPost<ProvinceDetailResponse>('/api/buildings/upgrade', { provinceId, type: b.type });
        state.setData(res);
        return res;
      },
      { success: `${BUILDINGS[b.type].name}: work begins on level ${b.nextLevel}.` },
    );

  const holdFestival = () =>
    festival.run(
      async () => {
        const res = await apiPost<ProvinceDetailResponse>(`/api/provinces/${provinceId}/festival`);
        state.setData(res);
        return res;
      },
      { success: `Drums sound across ${province.name}. The people rejoice.` },
    );

  const festivalWait = own.festival.availableAt && Date.parse(own.festival.availableAt) > now ? own.festival.availableAt : null;
  const festivalMissing = missingResources(resources, own.festival.cost);
  const festivalReason = festivalWait
    ? 'The last festival is still fresh in memory'
    : festivalMissing.length
      ? `Not enough ${festivalMissing.map((k) => RESOURCE_INFO[k].name.toLowerCase()).join(', ')}`
      : own.loyalty >= 100
        ? 'Loyalty is already at its height'
        : null;

  const levels = emptyBuildingLevels();
  for (const b of own.buildings) levels[b.type] = b.level;
  const underConstruction = own.buildings.find((b) => b.upgrading)?.type ?? null;

  return (
    <div className="space-y-4 lg:space-y-5">
    <CityView
      name={province.name}
      kanji={province.kanji}
      terrain={province.terrain}
      levels={levels}
      upgrading={underConstruction}
      bannerHex={bannerHex(clan.banner.color)}
      hour={world.hour}
    />
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-5">
      {/* buildings */}
      <Panel title={`Buildings of ${province.name}`} kanji="築" bodyClassName="p-3 sm:p-4">
        {own.constructionBusy ? <p className="mb-3 text-xs text-muted">A province builds one thing at a time. The builders are at work.</p> : null}
        <ul className="grid gap-3 xl:grid-cols-2">
          {own.buildings.map((b) => {
            const def = BUILDINGS[b.type];
            const missing = missingResources(resources, b.nextCost);
            const reason =
              b.blockedReason ??
              (own.constructionBusy && !b.upgrading ? 'The builders are busy with another project' : null) ??
              (missing.length ? `Not enough ${missing.map((k) => RESOURCE_INFO[k].name.toLowerCase()).join(', ')}` : null);
            return (
              <li key={b.type} className="panel-flat flex flex-col p-3.5">
                <div className="flex items-start gap-3">
                  <span className={cx('seal seal-lg', b.level === 0 && 'seal-ink')} aria-hidden>
                    <Icon name={def.type} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="font-display text-lg font-bold leading-tight">{def.name}</h3>
                      <span className="num shrink-0 text-sm text-gold">{b.level > 0 ? `Lv ${b.level} / ${b.maxLevel}` : 'Not built'}</span>
                    </div>
                    <p className="text-[0.7rem] uppercase tracking-wider text-muted">{def.role}</p>
                  </div>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-parchment/80">{def.description}</p>
                <dl className="mt-2 space-y-0.5 text-sm">
                  <div className="flex gap-2">
                    <dt className="w-12 shrink-0 text-muted">Now</dt>
                    <dd>{b.effect}</dd>
                  </div>
                  {b.nextEffect ? (
                    <div className="flex gap-2">
                      <dt className="w-12 shrink-0 text-muted">Next</dt>
                      <dd className="text-gold-bright">{b.nextEffect}</dd>
                    </div>
                  ) : null}
                </dl>

                <div className="mt-auto pt-3">
                  {b.upgrading ? (
                    <TimedProgress from={b.upgrading.startedAt} to={b.upgrading.completesAt} label={`Building level ${b.upgrading.toLevel}`} onDone={() => void state.refresh()} />
                  ) : b.nextLevel === null || !b.nextCost ? (
                    <p className="text-sm text-gold">This building has reached its greatest height.</p>
                  ) : (
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div className="space-y-1">
                        <CostRow cost={b.nextCost} have={resources} />
                        <p className="text-xs text-muted">
                          Takes <DurationText ms={b.nextDurationMs ?? 0} />
                        </p>
                      </div>
                      <ActionButton variant={b.level === 0 ? 'gold' : 'default'} reason={reason} busy={build.busy} onClick={() => void upgrade(b)} wrapperClassName="max-w-[13rem]">
                        {b.level === 0 ? 'Build' : `Upgrade to Lv ${b.nextLevel}`}
                      </ActionButton>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      {/* province status */}
      <div className="space-y-4 lg:space-y-5">
        <Panel title="People" kanji="民">
          <div className="space-y-4">
            <div>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="text-muted">Loyalty</span>
                <span className={cx('num font-bold', own.loyalty < 30 ? 'text-vermilion-bright' : own.loyalty >= 70 ? 'text-jade' : '')}>{Math.round(own.loyalty)} / 100</span>
              </div>
              <Bar value={own.loyalty} max={100} tone={own.loyalty < 30 ? 'red' : own.loyalty >= 70 ? 'jade' : 'gold'} label="Loyalty" />
              <p className="mt-1.5 text-xs leading-relaxed text-muted">Loyal provinces work harder: output runs from 50% at no loyalty to 100% at full loyalty. Below 30, rebellion threatens.</p>
            </div>
            <div>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="text-muted">Population</span>
                <span className="num font-bold">
                  {fmt(province.population)} / {fmt(own.populationCap)}
                </span>
              </div>
              <Bar value={province.population} max={own.populationCap} label="Population" />
              <p className="mt-1.5 text-xs leading-relaxed text-muted">
                Grows each day while there is food. Every recruit is drawn from the people; development raises the ceiling. They eat {fmt(own.foodConsumption)} food an hour.
              </p>
            </div>
          </div>
        </Panel>

        <Panel title="Hourly yield" kanji="産">
          <table className="table-ink">
            <thead>
              <tr>
                <th>Resource</th>
                <th className="!text-right">Base</th>
                <th className="!text-right">Actual</th>
              </tr>
            </thead>
            <tbody>
              {RESOURCE_KEYS.map((k) => (
                <tr key={k}>
                  <td>
                    <span className="flex items-center gap-2">
                      <span className="font-display font-bold text-gold" aria-hidden>
                        <Icon name={k} />
                      </span>
                      {RESOURCE_INFO[k].name}
                    </span>
                  </td>
                  <td className="num text-right text-muted">{fmt(province.base[k])}</td>
                  <td className={cx('num text-right font-bold', own.production[k] < province.base[k] ? 'text-vermilion-bright' : own.production[k] > province.base[k] ? 'text-jade' : '')}>
                    {fmt(own.production[k])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">Base × buildings × Economy skills × loyalty.</p>
        </Panel>

        <Panel title="Festival" kanji="祭">
          <p className="text-sm leading-relaxed text-parchment/85">
            Open the storehouses and let the province celebrate: <strong className="text-gold-bright">+{own.festival.loyaltyGain} loyalty</strong> and experience for the Culture pillar.
          </p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <CostRow cost={own.festival.cost} have={resources} />
              {festivalWait ? (
                <p className="text-xs text-muted">
                  Ready again in <Countdown to={festivalWait} className="text-gold-bright" onDone={() => void state.refresh()} />
                </p>
              ) : null}
            </div>
            <ActionButton reason={festivalReason} busy={festival.busy} onClick={() => void holdFestival()} wrapperClassName="max-w-[12rem]">
              Hold festival
            </ActionButton>
          </div>
        </Panel>

        <Panel
          title="Garrison"
          kanji="兵"
          action={
            <Link href={`/game/military?province=${provinceId}`} className="btn btn-sm">
              Recruit
            </Link>
          }
        >
          <UnitsRow units={own.garrison} />
          <p className="mt-1.5 text-xs text-muted">
            {fmt(totalUnits(own.garrison))} soldiers · {fmt(armyPower(own.garrison))} power
          </p>
          {own.recruitment.length > 0 ? (
            <div className="mt-3 space-y-2.5">
              {own.recruitment.map((r) => (
                <TimedProgress key={r.id} from={r.startedAt} to={r.completesAt} label={`Mustering ${fmt(r.count)} ${r.unitType}`} onDone={() => void state.refresh()} />
              ))}
            </div>
          ) : null}
        </Panel>
      </div>
    </div>
    </div>
  );
}
