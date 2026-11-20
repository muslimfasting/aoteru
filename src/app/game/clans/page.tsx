'use client';

/**
 * Nations: every nation in the realm, with the one thing the viewer can
 * do about each — join, apply, accept an invitation — or the reason they cannot.
 */
import Link from 'next/link';
import { useState } from 'react';
import type { ClanDirectoryEntryDTO, ClanDirectoryResponse } from '@/game/api';
import { CLAN_LANGUAGES, RECRUITMENT_DEFS, RECRUITMENT_MODES, DOCTRINE_DEFS } from '@/game/clan';
import { Banner } from '@/components/Banner';
import { ClanLink, ClanTag, JoinAction, RecruitmentChip } from '@/components/clan';
import { Icon } from '@/components/icons';
import { EmptyState, ErrorState, LoadingState, PageHeader, Panel } from '@/components/ui';
import { EVENTS } from '@/lib/events';
import { cx } from '@/lib/format';
import { useSession } from '@/lib/game-context';
import { useApi, useDebounced } from '@/lib/hooks';

export default function ClansPage() {
  const session = useSession();
  const [search, setSearch] = useState('');
  const [language, setLanguage] = useState('');
  const [recruitment, setRecruitment] = useState('');
  const [sort, setSort] = useState('rank');
  const query = useDebounced(search, 250);
  const qs = new URLSearchParams();
  if (query.trim()) qs.set('search', query.trim());
  if (language) qs.set('language', language);
  if (recruitment) qs.set('recruitment', recruitment);
  if (sort !== 'rank') qs.set('sort', sort);
  const state = useApi<ClanDirectoryResponse>(`/api/clans${qs.size ? `?${qs.toString()}` : ''}`, EVENTS.directory);
  // Filters change the path; keep the previous list on screen while the next one loads.
  const [last, setLast] = useState<ClanDirectoryResponse | undefined>(undefined);
  if (state.data && state.data !== last) setLast(state.data);
  const data = state.data ?? last;
  const filtered = Boolean(query.trim() || language || recruitment);

  return (
    <div>
      <PageHeader
        icon="clan"
        title="Nations"
        subtitle="Land, armies and treasuries belong to nations. Enter the service of one that suits you, or found a government of your own."
        action={
          session.clan ? (
            <Link href="/game/clan" className="btn btn-sm shrink-0">
              Government
            </Link>
          ) : undefined
        }
      />

      {!session.clan ? (
        <section className="paper mb-4 flex flex-wrap items-center gap-x-5 gap-y-3 p-4 sm:p-5">
          <span className="seal seal-lg shrink-0" aria-hidden>
            <Icon name="clan" />
          </span>
          <div className="min-w-0 flex-1 basis-56">
            <h2 className="font-display text-xl font-extrabold leading-tight">Found your own nation</h2>
            <p className="mt-0.5 text-sm">Choose a name, a tag and a flag, pick an open province for your capital, and decide who may join.</p>
          </div>
          <Link href="/found" className="btn btn-ink shrink-0">
            Found a nation
          </Link>
        </section>
      ) : null}

      {data && (data.invitations.length > 0 || data.applications.length > 0) ? (
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {data.invitations.length > 0 ? (
            <Panel title="Invitations for you" icon="mail" action={<span className="chip chip-red">{data.invitations.length}</span>} bodyClassName="p-0">
              <ul className="divide-y divide-gold/10">
                {data.invitations.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Banner color={i.clan.banner.color} mon={i.clan.banner.mon} size={40} className="shrink-0" />
                    <div className="min-w-0 flex-1 leading-tight">
                      <ClanLink id={i.clan.id} className="block truncate font-display font-bold">
                        {i.clan.name} <ClanTag tag={i.clan.tag} />
                      </ClanLink>
                      <span className="text-xs text-muted">{i.invitedBy ? `${i.invitedBy} invites you` : 'You are invited'}</span>
                    </div>
                    <JoinAction clan={i.clan} join={{ option: session.clan ? null : 'accept_invitation', blockedReason: session.clan ? 'Leave your nation first' : null, applicationId: null, invitationId: i.id }} size="sm" />
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {data.applications.length > 0 ? (
            <Panel title="Your applications" icon="scroll" bodyClassName="p-0">
              <ul className="divide-y divide-gold/10">
                {data.applications.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1 leading-tight">
                      <ClanLink id={a.clanId} className="block truncate font-display font-bold">
                        {a.clanName}
                      </ClanLink>
                      <span className="text-xs text-muted">Waiting for the nation&apos;s answer</span>
                    </div>
                    <JoinAction clan={{ id: a.clanId, name: a.clanName }} join={{ option: 'applied', blockedReason: null, applicationId: a.id, invitationId: null }} onDirectory={state.setData} size="sm" />
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      ) : null}

      {/* filters */}
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
        <div className="relative col-span-2 md:col-span-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden>
            <Icon name="search" />
          </span>
          <label className="sr-only" htmlFor="clan-search">
            Search nations by name or tag
          </label>
          <input id="clan-search" className="field !pl-10" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or tag" autoComplete="off" />
        </div>
        <div>
          <label className="sr-only" htmlFor="clan-language">
            Language
          </label>
          <select id="clan-language" className="field" value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">Any language</option>
            {CLAN_LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="sr-only" htmlFor="clan-recruitment">
            Recruitment
          </label>
          <select id="clan-recruitment" className="field" value={recruitment} onChange={(e) => setRecruitment(e.target.value)}>
            <option value="">Any recruitment</option>
            {RECRUITMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {RECRUITMENT_DEFS[m].name}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2 md:col-span-1">
          <label className="sr-only" htmlFor="clan-sort">
            Sort by
          </label>
          <select id="clan-sort" className="field" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="rank">Sort by rank</option>
            <option value="members">Sort by officials</option>
            <option value="name">Sort by name</option>
          </select>
        </div>
      </div>

      {state.error && !data ? (
        <ErrorState message={state.error.message} onRetry={() => void state.refresh()} />
      ) : !data ? (
        <LoadingState label="Counting the flags of the realm…" />
      ) : data.entries.length === 0 ? (
        <Panel>
          <EmptyState icon="clan" title={filtered ? 'No nation matches' : 'No nations yet'}>
            {filtered ? 'Try a different name, language or recruitment setting.' : 'Be the first to found one.'}
          </EmptyState>
        </Panel>
      ) : (
        <Panel bodyClassName="p-0" className={cx('overflow-hidden', state.loading && 'opacity-70')}>
          <ul className="divide-y divide-gold/10">
            {data.entries.map((e) => (
              <ClanRow key={e.clan.id} entry={e} max={data.maxMembers} onDirectory={state.setData} />
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function ClanRow({ entry, max, onDirectory }: { entry: ClanDirectoryEntryDTO; max: number; onDirectory: (res: ClanDirectoryResponse) => void }) {
  const { clan } = entry;
  const fallen = clan.status !== 'active';
  return (
    <li className={cx('flex flex-wrap items-center gap-x-4 gap-y-3 px-3.5 py-3.5 sm:px-4', entry.isViewer && 'bg-gold/10', fallen && 'opacity-60')}>
      <span className={cx('seal shrink-0', entry.rank === 1 ? 'seal-gold' : entry.rank === 0 || entry.rank > 3 ? 'seal-ink' : '')} title={entry.rank ? `Rank ${entry.rank}` : 'Unranked'}>
        {entry.rank || '–'}
      </span>
      <Link href={`/game/clans/${clan.id}`} className="shrink-0" aria-label={`Profile of ${clan.name}`}>
        <Banner color={clan.banner.color} mon={clan.banner.mon} size={48} />
      </Link>
      <div className="min-w-0 flex-1 basis-48 leading-tight">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <ClanLink id={clan.id} className="font-display text-lg font-bold">
            {clan.name} <ClanTag tag={clan.tag} />
          </ClanLink>
          {entry.isViewer ? <span className="chip">Your nation</span> : null}
          {fallen ? <span className="chip chip-muted">Fallen</span> : null}
          <RecruitmentChip clan={clan} />
        </div>
        <div className="mt-1 text-sm text-parchment/80">
          Led by{' '}
          {clan.isNpc ? (
            <span>{clan.daimyoName}</span>
          ) : (
            <span className="font-bold">{clan.playerNickname ?? clan.daimyoName}</span>
          )}
        </div>
        <div className="num mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            <Icon name="members" />
            {clan.isNpc ? 'no players' : `${clan.memberCount} / ${max} officials`}
          </span>
          <span className="inline-flex items-center gap-1">
            <Icon name="province" />
            {clan.provinceCount} {clan.provinceCount === 1 ? 'province' : 'provinces'}
            {entry.regionName ? ` · ${entry.regionName}` : ''}
          </span>
          {!clan.isNpc ? <span>{CLAN_LANGUAGES.find((l) => l.id === clan.language)?.name ?? clan.language}</span> : null}
          <span className="inline-flex items-center gap-1" title="Battles won and lost">
            <Icon name="military" />
            {clan.victories} won · {clan.defeats} lost
          </span>
          {clan.doctrine ? (
            <span className="inline-flex items-center gap-1 text-gold" title={DOCTRINE_DEFS[clan.doctrine].summary}>
              <Icon name="doctrine" />
              {DOCTRINE_DEFS[clan.doctrine].name}
            </span>
          ) : null}
        </div>
        {clan.description ? <p className="mt-1.5 line-clamp-2 break-words text-sm text-muted">{clan.description}</p> : null}
      </div>
      <div className="flex w-full flex-wrap items-start justify-end gap-2 sm:w-auto sm:max-w-[16rem] sm:flex-col sm:items-end">
        {entry.isViewer ? (
          <Link href="/game/clan" className="btn btn-sm btn-gold">
            Open
          </Link>
        ) : (
          <JoinAction clan={clan} join={entry.join} onDirectory={onDirectory} size="sm" />
        )}
        <Link href={`/game/clans/${clan.id}`} className="btn btn-sm btn-ghost">
          View
        </Link>
      </div>
    </li>
  );
}
