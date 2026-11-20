'use client';

import { useState } from 'react';
import type { EspionageOpDTO, EspionageResponse, IntelDTO, ProvinceDetailResponse, ProvinceSummaryDTO, WorldMapResponse } from '@/game/api';
import { BUILDINGS, BUILDING_TYPES, RESOURCE_INFO, RESOURCE_KEYS, totalUnits } from '@/game/config';
import { PROVINCE_BY_CODE } from '@/game/map';
import { relationChip } from '@/components/ProvincePanel';
import { ActionButton, ConfirmDialog, Countdown, EmptyState, ErrorState, LoadingState, PageHeader, Panel, TimedProgress, UnitsRow } from '@/components/ui';
import { apiPost } from '@/lib/api';
import { useNow } from '@/lib/clock';
import { EVENTS } from '@/lib/events';
import { cx, fmt, fmtDuration, fmtPct, timeAgo } from '@/lib/format';
import { useGame } from '@/lib/game-context';
import { useAction, useApi } from '@/lib/hooks';

import { Glyph, Icon } from '@/components/icons';
export default function IntelPage() {
  const ops = useApi<EspionageResponse>('/api/espionage', EVENTS.intel);
  const map = useApi<WorldMapResponse>('/api/world/map', EVENTS.map);
  const [target, setTarget] = useState<ProvinceSummaryDTO | null>(null);
  const now = useNow();

  const pending = ops.data?.operations.filter((o) => o.status === 'pending') ?? [];
  const reports = ops.data?.operations.filter((o) => o.status === 'success' && o.report && !o.reportExpired) ?? [];
  const past = ops.data?.operations.filter((o) => o.status === 'failed' || (o.status === 'success' && (o.reportExpired || !o.report))) ?? [];
  // Scouts work from the nation's own borders: provinces next to land you hold come first, the rest are out of reach.
  const ownCodes = new Set(map.data?.provinces.filter((p) => p.relation === 'own').map((p) => p.code) ?? []);
  const inReach = (p: ProvinceSummaryDTO) => (PROVINCE_BY_CODE[p.code]?.neighbors ?? []).some((code) => ownCodes.has(code));
  const targets = (map.data?.provinces.filter((p) => p.relation !== 'own') ?? []).sort((a, b) => Number(inReach(b)) - Number(inReach(a)));
  const pendingTargets = new Set(pending.map((o) => o.targetProvinceId));

  return (
    <div>
      <PageHeader kanji="忍" title="Intelligence" subtitle="Count the enemy's spears before you draw your own. Reports grow stale, and scouts can be caught." />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-5">
        <div className="space-y-4 lg:space-y-5">
          {ops.error && !ops.data ? (
            <ErrorState message={ops.error.message} onRetry={() => void ops.refresh()} />
          ) : !ops.data ? (
            <LoadingState label="Waiting for word from the shadows…" />
          ) : (
            <>
              <Panel title="Scouts in the field" kanji="潜">
                {pending.length === 0 ? (
                  <p className="text-sm text-muted">No scouts are abroad. Choose a province to send one.</p>
                ) : (
                  <ul className="space-y-3">
                    {pending.map((o) => (
                      <li key={o.id} className="panel-flat p-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <span className="font-display font-bold">Scouting {o.targetProvinceName}</span>
                          <span className="num text-xs text-muted">
                            {fmtPct(o.successChance)} chance · {fmt(o.cost)} gold
                          </span>
                        </div>
                        <TimedProgress from={o.startedAt} to={o.completesAt} label="Returning with a report" onDone={() => void ops.refresh()} />
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title="Current reports" kanji="報">
                {reports.length === 0 ? (
                  <EmptyState kanji="闇" title="No fresh intelligence">
                    A successful scout reveals the exact garrison, walls, buildings and stores of a province for a limited time.
                  </EmptyState>
                ) : (
                  <ul className="grid gap-3 xl:grid-cols-2">
                    {reports.map((o) => (
                      <ReportCard key={o.id} op={o} report={o.report!} onExpire={() => void ops.refresh()} />
                    ))}
                  </ul>
                )}
              </Panel>

              {past.length > 0 ? (
                <Panel title="Past operations" kanji="古" bodyClassName="p-0">
                  <ul className="divide-y divide-gold/10">
                    {past.map((o) => (
                      <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                        <span className={cx('seal seal-sm', o.status === 'failed' ? '' : 'seal-ink')} aria-hidden>
                          <Glyph k={o.status === 'failed' ? '失' : '古'} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="font-display font-bold">{o.targetProvinceName}</span>
                          <span className="text-muted"> — {o.status === 'failed' ? 'the scout learned nothing' : 'report expired'}</span>
                          {o.detected ? <span className="text-vermilion-bright"> · discovered</span> : null}
                        </span>
                        <span className="num text-xs text-muted">{now ? timeAgo(o.resolvedAt ?? o.completesAt, now) : ''}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              ) : null}
            </>
          )}
        </div>

        <Panel title="Send a scout" kanji="偵" className="self-start" bodyClassName="p-0">
          {map.error && !map.data ? (
            <ErrorState message={map.error.message} onRetry={() => void map.refresh()} />
          ) : !map.data ? (
            <LoadingState />
          ) : targets.length === 0 ? (
            <EmptyState title="Nothing left to scout">Every province flies your banner.</EmptyState>
          ) : (
            <ul className="divide-y divide-gold/10">
              {targets.map((p) => {
                const chip = relationChip(p.relation);
                const owner = map.data!.clans.find((c) => c.id === p.ownerClanId);
                return (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="paper grid h-10 w-10 shrink-0 place-items-center font-display text-base font-bold"><Glyph k={p.kanji} /></span>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-display font-bold">{p.name}</span>
                        <span className={chip.cls}>{chip.label}</span>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {owner ? owner.name : 'Local warriors'} · {p.strength ? p.strength.label : 'strength unknown'}
                      </span>
                    </span>
                    <ActionButton size="sm" onClick={() => setTarget(p)} reason={pendingTargets.has(p.id) ? 'Scout abroad' : inReach(p) ? null : 'Beyond your borders'}>
                      Scout
                    </ActionButton>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      {target ? (
        <ScoutDialog
          province={target}
          onClose={() => setTarget(null)}
          onSent={(res) => {
            ops.setData(res);
            setTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ScoutDialog({ province, onClose, onSent }: { province: ProvinceSummaryDTO; onClose: () => void; onSent: (res: EspionageResponse) => void }) {
  const detail = useApi<ProvinceDetailResponse>(`/api/provinces/${province.id}`);
  const { resources, lacks } = useGame();
  const action = useAction();
  const actions = detail.data?.actions;

  const send = async () => {
    const res = await action.run(() => apiPost<EspionageResponse>('/api/espionage/execute', { operation: 'scout', provinceId: province.id }), {
      success: `A scout slips across the border into ${province.name}.`,
    });
    if (res) onSent(res);
  };

  const lacksGold = actions ? resources.gold < actions.scoutCost : false;
  const blocked = lacks('espionage') ?? (actions ? (actions.scoutBlockedReason ?? (lacksGold ? 'Not enough gold' : null)) : null);

  return (
    <ConfirmDialog open onClose={onClose} onConfirm={send} busy={action.busy || !actions} blockedReason={blocked} title={`Scout ${province.name}`} kanji="忍" confirmLabel={actions ? `Send scout · ${fmt(actions.scoutCost)} gold` : 'Send scout'}>
      {detail.error && !detail.data ? (
        <ErrorState message={detail.error.message} onRetry={() => void detail.refresh()} />
      ) : !actions ? (
        <LoadingState label="Briefing the scout…" className="!py-4" />
      ) : (
        <>
          <p>A scout will cross into {province.name} and count its defenders, walls and stores.</p>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="panel-flat px-2 py-2">
              <dt className="text-[0.62rem] uppercase tracking-wider text-muted">Cost</dt>
              <dd className={cx('num font-display text-lg font-bold', lacksGold && 'text-vermilion-bright')}>{fmt(actions.scoutCost)}</dd>
            </div>
            <div className="panel-flat px-2 py-2">
              <dt className="text-[0.62rem] uppercase tracking-wider text-muted">Success</dt>
              <dd className="num font-display text-lg font-bold">{fmtPct(actions.scoutChance)}</dd>
            </div>
            <div className="panel-flat px-2 py-2">
              <dt className="text-[0.62rem] uppercase tracking-wider text-muted">Returns in</dt>
              <dd className="num font-display text-lg font-bold">{fmtDuration(actions.scoutDurationMs)}</dd>
            </div>
          </dl>
          {blocked ? null : <p className="text-xs text-muted">If the scout is caught, the ruler of {province.name} learns that you were watching.</p>}
        </>
      )}
    </ConfirmDialog>
  );
}

function ReportCard({ op, report, onExpire }: { op: EspionageOpDTO; report: IntelDTO; onExpire: () => void }) {
  return (
    <li className="paper p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-lg font-bold leading-tight">{op.targetProvinceName}</h3>
          <p className="text-xs text-ink-700">
            valid for <Countdown to={report.expiresAt} className="font-bold" done="expired" onDone={onExpire} />
            {op.detected ? ' · your scout was seen' : ''}
          </p>
        </div>
        <span className="seal seal-sm" aria-hidden>
          <Glyph k="密" />
        </span>
      </div>
      <div className="mt-2.5">
        <UnitsRow units={report.units} />
        <p className="num mt-1.5 text-sm">
          {fmt(totalUnits(report.units))} soldiers · <strong>{fmt(report.power)} power</strong> · castle Lv {report.castleLevel} · loyalty {Math.round(report.loyalty)}
        </p>
      </div>
      <p className="mt-2 text-xs text-ink-700">
        {BUILDING_TYPES.filter((t) => report.buildings[t] > 0)
          .map((t) => `${BUILDINGS[t].name} ${report.buildings[t]}`)
          .join(' · ') || 'No buildings of note'}
      </p>
      {report.ownerResources ? (
        <p className="num mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-ink-900/20 pt-2 text-sm">
          <span className="text-xs uppercase tracking-wider text-ink-600">Their stores</span>
          {RESOURCE_KEYS.map((k) => (
            <span key={k} title={RESOURCE_INFO[k].name}>
              <span className="font-display font-bold text-vermilion-deep" aria-hidden>
                <Icon name={k} />
              </span>{' '}
              <span className="sr-only">{RESOURCE_INFO[k].name}</span>
              {fmt(report.ownerResources![k])}
            </span>
          ))}
        </p>
      ) : null}
    </li>
  );
}
