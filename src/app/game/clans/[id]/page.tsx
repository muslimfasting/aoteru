'use client';

/** Nation profile: the public face of any nation — flag, officials, land — and how to join it. */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ClanProfileResponse } from '@/game/api';
import { CLAN_LANGUAGES, DOCTRINE_DEFS, RECRUITMENT_DEFS, ROLE_DEFS } from '@/game/clan';
import { PILLAR_DEFS } from '@/game/pillars';
import { Banner } from '@/components/Banner';
import { ClanTag, JoinAction, PlayerLink, RecruitmentChip, RoleBadge } from '@/components/clan';
import { Icon } from '@/components/icons';
import { Portrait } from '@/components/Portrait';
import { DOCTRINE_ICON, DoctrineEffects } from '@/components/DoctrinePanel';
import { ErrorState, LoadingState, Panel, Stat } from '@/components/ui';
import { EVENTS } from '@/lib/events';
import { cx, fmt } from '@/lib/format';
import { useApi } from '@/lib/hooks';

export default function ClanProfilePage() {
  const { id } = useParams<{ id: string }>();
  const state = useApi<ClanProfileResponse>(id ? `/api/clans/${id}` : null, EVENTS.directory);

  return (
    <div>
      <Link href="/game/clans" className="mb-3 inline-flex min-h-[44px] items-center gap-1.5 text-sm text-muted hover:text-parchment">
        ← All nations
      </Link>
      {state.error && !state.data ? (
        <ErrorState message={state.error.message} onRetry={() => void state.refresh()} />
      ) : !state.data ? (
        <LoadingState label="Opening the file on this nation…" />
      ) : (
        <Profile data={state.data} onChanged={() => void state.refresh()} />
      )}
    </div>
  );
}

function Profile({ data, onChanged }: { data: ClanProfileResponse; onChanged: () => void }) {
  const { clan } = data;
  const fallen = clan.status !== 'active';
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-5">
      <div className="space-y-4 lg:space-y-5">
        <section className="panel p-4 sm:p-5">
          <div className="flex flex-wrap items-start gap-4">
            <Banner color={clan.banner.color} mon={clan.banner.mon} size={104} title={`Flag of ${clan.name}`} className="shrink-0" />
            <div className="min-w-0 flex-1 basis-56">
              <h1 className="font-display text-2xl font-extrabold leading-tight sm:text-3xl">
                {clan.name} <ClanTag tag={clan.tag} />
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {data.isMember ? <span className="chip">Your nation</span> : null}
                {fallen ? <span className="chip chip-muted">Fallen</span> : null}
                <RecruitmentChip clan={clan} />
                {!clan.isNpc ? <span className="chip chip-muted">{CLAN_LANGUAGES.find((l) => l.id === clan.language)?.name ?? clan.language}</span> : null}
              </div>
              <p className="mt-2 text-sm text-parchment/85">
                Led by <span className="font-bold">{clan.isNpc ? clan.daimyoName : (clan.playerNickname ?? clan.daimyoName)}</span>
                {clan.isNpc ? ' — a rival government, run by the realm itself' : ''}
              </p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted">{clan.description || (clan.isNpc ? 'A rival government that answers to no player.' : 'This nation has not described itself yet.')}</p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-gold/15 pt-3 sm:grid-cols-5">
            <Stat label="Rank" value={data.rank ? `#${data.rank}` : '—'} hint={`${fmt(clan.score)} renown`} />
            <Stat label="War record" value={`${clan.victories} – ${clan.defeats}`} hint="battles won – lost" />
            <Stat label="Provinces" value={clan.provinceCount} hint={data.regionName ?? undefined} />
            <Stat label="Officials" value={clan.isNpc ? '—' : clan.memberCount} />
            <Stat label="Recruitment" value={clan.isNpc ? 'Closed' : RECRUITMENT_DEFS[clan.recruitment].name} />
          </dl>
        </section>

        {clan.doctrine ? (
          <Panel title="Doctrine" icon="doctrine">
            <div className="flex items-start gap-3">
              <span className="seal seal-sm seal-ink shrink-0" aria-hidden>
                <Icon name={DOCTRINE_ICON[clan.doctrine]} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-base font-bold leading-tight">{DOCTRINE_DEFS[clan.doctrine].name}</p>
                <p className="text-sm italic text-muted">{DOCTRINE_DEFS[clan.doctrine].motto}</p>
                <p className="mt-1 text-sm text-parchment/85">{DOCTRINE_DEFS[clan.doctrine].summary}</p>
                <DoctrineEffects doctrine={clan.doctrine} className="mt-2" />
              </div>
            </div>
          </Panel>
        ) : null}

        <Panel title={clan.isNpc ? 'Officials' : `Officials · ${data.members.length}`} icon="members" bodyClassName="p-0">
          {data.members.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted">{clan.isNpc ? 'No players serve this government.' : 'This nation has no officials.'}</p>
          ) : (
            <ul className="divide-y divide-gold/10">
              {data.members.map((m) => (
                <li key={m.playerId} className={cx('flex items-center gap-3 px-3.5 py-2.5 sm:px-4', m.isYou && 'bg-gold/8')}>
                  <Portrait id={m.portrait} accent={clan.banner.color} size={42} className="shrink-0" />
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <PlayerLink id={m.playerId} className="truncate font-display font-bold">
                        {m.nickname}
                      </PlayerLink>
                      {m.isYou ? <span className="chip">You</span> : null}
                      <RoleBadge role={m.role} />
                    </div>
                    <div className="num mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                      <span>Level {m.level}</span>
                      {m.carries.length > 0 ? (
                        <span className="inline-flex items-center gap-1 text-gold" title={`Carries ${m.carries.map((p) => PILLAR_DEFS[p].name).join(', ')} for the nation`}>
                          carries
                          {m.carries.map((p) => (
                            <Icon key={p} name={p} />
                          ))}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {!m.isYou ? (
                    <Link href={`/game/messages?with=${m.playerId}`} className="btn btn-sm btn-ghost shrink-0" aria-label={`Message ${m.nickname}`} title={`Message ${m.nickname}`}>
                      <Icon name="mail" />
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="space-y-4 lg:space-y-5">
        <Panel title={data.isMember ? 'You serve this nation' : 'Join this nation'} icon="clan">
          {data.isMember ? (
            <>
              <p className="text-sm text-muted">This is your nation. Its treasury, officials and settings are on the government screen.</p>
              <Link href="/game/clan" className="btn btn-gold mt-3">
                Open the government
              </Link>
            </>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted">
                {clan.isNpc
                  ? 'Rival governments cannot be joined. They can be fought, or made peace with.'
                  : `${RECRUITMENT_DEFS[clan.recruitment].name}: ${RECRUITMENT_DEFS[clan.recruitment].summary} Newcomers start as ${ROLE_DEFS.recruit.name}.`}
              </p>
              <JoinAction clan={clan} join={data.join} onDirectory={onChanged} align="start" />
            </>
          )}
        </Panel>

        <Panel title="Land" icon="map" bodyClassName="p-0">
          {data.provinces.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted">This nation holds no land.</p>
          ) : (
            <ul className="divide-y divide-gold/10">
              {data.provinces.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="seal seal-sm seal-ink" aria-hidden>
                    <Icon name={p.isCapital ? 'castle' : 'province'} />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-display font-bold">{p.name}</span>
                  {p.isCapital ? <span className="chip">Headquarters</span> : null}
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-gold/15 px-4 py-2 text-xs text-muted">
            <Link href="/game/map" className="tap-link text-gold">
              See it on the map
            </Link>
          </p>
        </Panel>
      </div>
    </div>
  );
}
