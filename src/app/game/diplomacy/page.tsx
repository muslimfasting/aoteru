'use client';

import { useState } from 'react';
import type { ClanPublicDTO, DiplomacyClanDTO, DiplomacyResponse, WarDTO } from '@/game/api';
import { Banner } from '@/components/Banner';
import { Portrait } from '@/components/Portrait';
import { ActionButton, ConfirmDialog, Countdown, EmptyState, ErrorState, LoadingState, PageHeader, Panel } from '@/components/ui';
import { apiPost } from '@/lib/api';
import { useNow } from '@/lib/clock';
import { EVENTS } from '@/lib/events';
import { cx, fmt, fmtDateTime } from '@/lib/format';
import { useGame } from '@/lib/game-context';
import { useAction, useApi } from '@/lib/hooks';

export default function DiplomacyPage() {
  const state = useApi<DiplomacyResponse>('/api/diplomacy', EVENTS.diplomacy);
  const { clan, resources, lacks } = useGame();
  // War and peace are decided by officials whose role holds the Diplomacy permission.
  const noDiplomacy = lacks('diplomacy');
  const action = useAction();
  const now = useNow();
  const [warTarget, setWarTarget] = useState<DiplomacyClanDTO | null>(null);

  if (state.error && !state.data) return <ErrorState message={state.error.message} onRetry={() => void state.refresh()} />;
  if (!state.data) return <LoadingState label="Receiving the envoys…" />;
  const data = state.data;

  const mutate = (fn: () => Promise<DiplomacyResponse>, success: string) =>
    action.run(
      async () => {
        const res = await fn();
        state.setData(res);
        return res;
      },
      { success },
    );

  const declare = async () => {
    if (!warTarget) return;
    const res = await mutate(() => apiPost<DiplomacyResponse>('/api/wars/declare', { clanId: warTarget.clan.id }), `War is declared on the ${warTarget.clan.name}.`);
    if (res) setWarTarget(null);
  };

  const atWar = data.clans.filter((c) => c.relation === 'war');
  const others = data.clans.filter((c) => c.relation !== 'war');
  const clanName = (id: string) => (id === clan.id ? `${clan.name} (you)` : (data.clans.find((c) => c.clan.id === id)?.clan.name ?? 'a fallen nation'));
  const myProtection = clan.protectedUntil && Date.parse(clan.protectedUntil) > now ? clan.protectedUntil : null;

  const row = (c: DiplomacyClanDTO) => (
    <ClanRow
      key={c.clan.id}
      entry={c}
      busy={action.busy}
      blocked={noDiplomacy}
      warCost={data.warCost}
      now={now}
      onDeclare={() => setWarTarget(c)}
      onPropose={() => void mutate(() => apiPost<DiplomacyResponse>('/api/diplomacy/propose', { clanId: c.clan.id, type: 'peace' }), `An envoy carries your offer of peace to the ${c.clan.name}.`)}
      onRespond={(accept) =>
        c.proposalId
          ? void mutate(
              () => apiPost<DiplomacyResponse>('/api/diplomacy/respond', { proposalId: c.proposalId, accept }),
              accept ? `Peace is made with the ${c.clan.name}.` : `The ${c.clan.name}'s envoy is sent away.`,
            )
          : undefined
      }
    />
  );

  return (
    <div>
      <PageHeader kanji="交" title="Diplomacy" subtitle="Know your rivals. War must be declared before you may march on another nation's land." />

      {data.clans.length === 0 ? (
        <EmptyState title="No other nations">You are alone in the realm — for now.</EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-5">
          <div className="space-y-4 lg:space-y-5">
            {atWar.length > 0 ? (
              <Panel title="At war" kanji="戦" bodyClassName="p-0">
                <ul className="divide-y divide-gold/10">{atWar.map(row)}</ul>
              </Panel>
            ) : null}
            <Panel title={atWar.length > 0 ? 'Other nations' : 'Nations of the realm'} kanji="家" bodyClassName="p-0">
              {others.length === 0 ? <p className="p-4 text-sm text-muted">You are at war with every nation in the realm.</p> : <ul className="divide-y divide-gold/10">{others.map(row)}</ul>}
            </Panel>
          </div>

          <div className="space-y-4 lg:space-y-5">
            <Panel title="Rules of war" kanji="法">
              <ul className="space-y-2.5 text-sm leading-relaxed text-parchment/85">
                <li>
                  Declaring war costs <strong className="text-gold-bright">{fmt(data.warCost)} gold</strong> for envoys and banners. Culture skills lower it.
                </li>
                <li>Unclaimed provinces can be attacked at any time; another nation&apos;s land only while you are at war with it.</li>
                <li>New nations stand under the founding truce and cannot be attacked until it lapses.</li>
                <li>Either side may offer peace. Once made, a truce forbids a new war between the two nations for a time.</li>
              </ul>
              {myProtection ? (
                <p className="mt-3 rounded-[3px] border border-gold/30 bg-gold/10 px-3 py-2 text-sm">
                  Your own truce lasts another <Countdown to={myProtection} className="font-bold text-gold-bright" done="a moment" />. Declaring war ends it at once.
                </p>
              ) : null}
            </Panel>

            <Panel title="History of your wars" kanji="史">
              {data.wars.length === 0 ? (
                <p className="text-sm text-muted">You have fought no wars. The chronicle of your nation is still unstained.</p>
              ) : (
                <ul className="space-y-2.5">
                  {data.wars.map((w) => (
                    <WarRow key={w.id} war={w} clanName={clanName} />
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={warTarget !== null}
        onClose={() => setWarTarget(null)}
        onConfirm={declare}
        busy={action.busy}
        danger
        title={warTarget ? `Declare war on the ${warTarget.clan.name}?` : 'Declare war'}
        kanji="戦"
        confirmLabel={`Declare war · ${fmt(data.warCost)} gold`}
      >
        {warTarget ? (
          <>
            <p>
              Your envoy will deliver the declaration to <strong>{warTarget.clan.daimyoName}</strong>. From that moment your armies may march on their {warTarget.clan.provinceCount}{' '}
              {warTarget.clan.provinceCount === 1 ? 'province' : 'provinces'} — and theirs on yours.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-muted">
              <li>
                The treasury pays <span className={cx('font-bold', resources.gold < data.warCost ? 'text-vermilion-bright' : 'text-gold-bright')}>{fmt(data.warCost)} gold</span> (you have {fmt(resources.gold)}).
              </li>
              {myProtection ? <li>Your protection under the founding truce ends immediately.</li> : null}
              <li>The war lasts until both sides agree to peace or one nation falls.</li>
            </ul>
          </>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

function ClanIdentity({ clan }: { clan: ClanPublicDTO }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <Portrait id={clan.portrait} accent={clan.banner.color} size={52} className="shrink-0" />
      <div className="min-w-0 leading-tight">
        <div className="flex items-center gap-2">
          <span className="truncate font-display text-lg font-bold">{clan.name}</span>
          <Banner color={clan.banner.color} mon={clan.banner.mon} size={26} />
        </div>
        <div className="truncate text-sm text-parchment/80">{clan.daimyoName}</div>
        <div className="num truncate text-xs text-muted">
          {clan.isNpc ? 'Rival government' : `[${clan.tag}] · ${clan.memberCount} ${clan.memberCount === 1 ? 'official' : 'officials'}`} · {clan.provinceCount} {clan.provinceCount === 1 ? 'province' : 'provinces'} · {fmt(clan.score)} renown
        </div>
      </div>
    </div>
  );
}

function ClanRow({
  entry,
  busy,
  blocked,
  warCost,
  now,
  onDeclare,
  onPropose,
  onRespond,
}: {
  entry: DiplomacyClanDTO;
  busy: boolean;
  /** Why the viewer's role may not act in diplomacy, or null. */
  blocked: string | null;
  warCost: number;
  now: number;
  onDeclare: () => void;
  onPropose: () => void;
  onRespond: (accept: boolean) => void;
}) {
  const { clan, relation, pendingPeace } = entry;
  const protectedUntil = clan.protectedUntil && Date.parse(clan.protectedUntil) > now ? clan.protectedUntil : null;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5">
      <ClanIdentity clan={clan} />
      <div className="flex flex-wrap items-center gap-1.5">
        {clan.status === 'fallen' ? <span className="chip chip-muted">Fallen</span> : relation === 'war' ? <span className="chip chip-red">At war</span> : <span className="chip chip-muted">Neutral</span>}
        {protectedUntil ? (
          <span className="chip">
            Truce <Countdown to={protectedUntil} done="ending" />
          </span>
        ) : null}
      </div>
      <div className="flex w-full flex-wrap items-start justify-end gap-2 sm:w-auto">
        {relation === 'war' ? (
          pendingPeace === 'incoming' ? (
            <>
              <span className="w-full text-right text-sm text-gold-bright sm:w-auto sm:self-center">They offer peace.</span>
              <ActionButton variant="gold" size="sm" busy={busy} reason={blocked} onClick={() => onRespond(true)}>
                Accept peace
              </ActionButton>
              <button type="button" className="btn btn-sm" disabled={busy || !!blocked} onClick={() => onRespond(false)}>
                Refuse
              </button>
            </>
          ) : pendingPeace === 'outgoing' ? (
            <span className="self-center text-sm text-muted">Your envoy awaits their answer…</span>
          ) : (
            <ActionButton size="sm" busy={busy} reason={blocked} onClick={onPropose}>
              Offer peace
            </ActionButton>
          )
        ) : clan.status === 'fallen' ? null : (
          <ActionButton variant="primary" size="sm" reason={blocked ?? (entry.canDeclareWar ? null : (entry.declareBlockedReason ?? 'War cannot be declared now'))} busy={busy} onClick={onDeclare} wrapperClassName="max-w-[14rem]">
            Declare war · {fmt(warCost)}
          </ActionButton>
        )}
      </div>
    </li>
  );
}

function WarRow({ war, clanName }: { war: WarDTO; clanName: (id: string) => string }) {
  return (
    <li className="panel-flat p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-display font-bold">
          {clanName(war.attackerClanId)} <span className="font-body text-xs font-normal text-muted">declared on</span> {clanName(war.defenderClanId)}
        </span>
        <span className={war.status === 'active' ? 'chip chip-red' : 'chip chip-muted'}>{war.status === 'active' ? 'Ongoing' : 'Ended'}</span>
      </div>
      <p className="mt-1 text-xs text-muted">
        Declared {fmtDateTime(war.declaredAt)}
        {war.endedAt ? ` · ended ${fmtDateTime(war.endedAt)}` : ''}
      </p>
    </li>
  );
}
