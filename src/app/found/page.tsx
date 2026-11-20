'use client';

/**
 * Founding a nation: name it and its head of government, choose its tag, flag
 * and recruitment rules, and pick the province for its capital. The head of a
 * fallen nation uses the same screen to found its new capital.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { MeResponse, WorldMapResponse } from '@/game/api';
import { CLAN_LANGUAGES, CLAN_RULES, RECRUITMENT_DEFS, RECRUITMENT_MODES, ROLE_DEFS, type RecruitmentMode } from '@/game/clan';
import { BANNER_COLORS, BANNER_MONS, NAME_RULES, PORTRAITS, RESOURCE_INFO, RESOURCE_KEYS, TERRAIN_INFO, WORLD } from '@/game/config';
import { PROVINCE_BY_CODE } from '@/game/map';
import { FormField } from '@/components/AuthShell';
import { Banner, MonBadge } from '@/components/Banner';
import { Brand } from '@/components/Brand';
import { Portrait } from '@/components/Portrait';
import { ActionButton, ErrorState, LoadingState } from '@/components/ui';
import { WorldMap } from '@/components/WorldMap';
import { ApiError, apiGet, apiPost, errorMessage } from '@/lib/api';
import { syncServerClock } from '@/lib/clock';
import { cx, fmt } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { useToast } from '@/components/toast';

import { Glyph, Icon } from '@/components/icons';
function nameError(value: string, rule: { min: number; max: number; pattern: RegExp }, what: string): string | null {
  const v = value.trim();
  if (v.length < rule.min || v.length > rule.max) return `${what} must be ${rule.min}–${rule.max} characters.`;
  if (!rule.pattern.test(v)) return 'Letters, numbers, spaces, hyphens and apostrophes only.';
  return null;
}

export default function FoundPage() {
  const router = useRouter();
  const toast = useToast();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  const map = useApi<WorldMapResponse>(me ? '/api/world/map' : null, ['world:province_updated']);

  const [daimyoName, setDaimyoName] = useState('');
  const [clanName, setClanName] = useState('');
  const [tag, setTag] = useState('');
  const [tagEdited, setTagEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [recruitment, setRecruitment] = useState<RecruitmentMode>('application');
  const [language, setLanguage] = useState<string>('en');
  const [portrait, setPortrait] = useState<string>(PORTRAITS[0].id);
  const [color, setColor] = useState<string>(BANNER_COLORS[0].id);
  const [mon, setMon] = useState<string>(BANNER_MONS[0].id);
  const [provinceId, setProvinceId] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMe = () => {
    setMeError(null);
    apiGet<MeResponse>('/api/player/me')
      .then((res) => {
        syncServerClock(res.world.now);
        if (res.clan && res.clan.status === 'active') {
          router.replace('/game');
          return;
        }
        // Only the head of a fallen nation founds its new capital; its other officials wait or leave.
        if (res.clan && res.membership?.role !== 'leader') {
          router.replace('/game/clan');
          return;
        }
        setMe(res);
        setPortrait(res.player.portrait);
        if (res.clan) {
          // Rising again: start from the old identity.
          setDaimyoName(res.clan.daimyoName);
          setClanName(res.clan.name);
          setTag(res.clan.tag);
          setTagEdited(true);
          setDescription(res.clan.description);
          setRecruitment(res.clan.recruitment);
          setLanguage(res.clan.language);
          setPortrait(res.clan.portrait);
          setColor(res.clan.banner.color);
          setMon(res.clan.banner.mon);
        } else {
          setDaimyoName(res.player.nickname.replace(/_/g, ' '));
        }
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/login');
        else setMeError(errorMessage(err));
      });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadMe, []);

  const fallen = me?.clan?.status === 'fallen';
  const takenColors = useMemo(() => new Set((map.data?.clans ?? []).filter((c) => c.status === 'active').map((c) => c.banner.color)), [map.data]);
  const slots = useMemo(() => (map.data?.provinces ?? []).filter((p) => p.isStartSlot), [map.data]);

  // Keep the chosen colour and province valid as the world changes.
  useEffect(() => {
    if (!map.data) return;
    if (takenColors.has(color)) {
      const free = BANNER_COLORS.find((c) => !takenColors.has(c.id));
      if (free) setColor(free.id);
    }
    if (provinceId && !slots.some((p) => p.id === provinceId)) setProvinceId(null);
  }, [map.data, takenColors, color, provinceId, slots]);

  const daimyoErr = nameError(daimyoName, NAME_RULES.daimyoName, 'The name');
  const clanErr = nameError(clanName, NAME_RULES.clanName, 'The name of the nation');
  const cleanTag = tag.trim().toUpperCase();
  const tagErr =
    cleanTag.length < CLAN_RULES.tag.min || cleanTag.length > CLAN_RULES.tag.max
      ? `The tag must be ${CLAN_RULES.tag.min}–${CLAN_RULES.tag.max} characters.`
      : CLAN_RULES.tag.pattern.test(cleanTag)
        ? null
        : 'Letters and numbers only.';
  const tagTaken = (map.data?.clans ?? []).some((c) => c.id !== me?.clan?.id && c.tag.toUpperCase() === cleanTag);
  const selected = slots.find((p) => p.id === provinceId) ?? null;
  const def = selected ? PROVINCE_BY_CODE[selected.code] : null;

  const blocked =
    clanErr ??
    tagErr ??
    (tagTaken ? 'Another nation already uses that tag' : null) ??
    daimyoErr ??
    (takenColors.has(color) ? 'Another nation already flies that colour' : null) ??
    (!provinceId ? 'Choose a province on the map' : null);

  const submit = async () => {
    setTouched(true);
    if (blocked || busy || !provinceId) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost<MeResponse>('/api/clans', {
        clanName: clanName.trim(),
        tag: cleanTag,
        description: description.trim(),
        recruitment,
        language,
        daimyoName: daimyoName.trim(),
        portrait,
        bannerColor: color,
        bannerMon: mon,
        provinceId,
      });
      toast.success(`The flag of ${clanName.trim()} rises over ${selected?.name ?? 'your province'}.`);
      router.replace('/game');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
      void map.refresh();
    }
  };

  if (meError) {
    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <ErrorState message={meError} onRetry={loadMe} />
      </div>
    );
  }
  if (!me) {
    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <LoadingState label="Preparing the brush and seal…" />
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-6xl px-3 pb-28 pt-4 sm:px-5 lg:pb-10">
      <header className="mb-5 flex items-center justify-between gap-3">
        <Brand href="/found" />
        <span className="truncate text-sm text-muted">
          Signed in as <span className="font-bold text-parchment">{me.player.nickname}</span>
        </span>
      </header>

      <div className="mb-5">
        <p className="heading-rule mb-2 max-w-sm">{fallen ? 'The nation endures' : 'A new nation is founded'}</p>
        <h1 className="font-display text-3xl font-extrabold sm:text-4xl">{fallen ? 'Found a new capital' : 'Found your nation'}</h1>
        <p className="mt-1 max-w-2xl text-muted">
          {fallen
            ? 'Your nation has lost its last province, but its officials remain and keep everything the Five Pillars taught them. Raise the flag over new land.'
            : `Name the nation, design the flag its soldiers will follow, decide who may join, and choose the province for its capital. You become its ${ROLE_DEFS.leader.name}; others can enter its service.`}
        </p>
        {!fallen ? (
          <p className="mt-2 text-sm text-muted">
            Rather serve an existing nation?{' '}
            <Link href="/game/clans" className="tap-link text-gold">
              Browse the nations and join one
            </Link>
            .
          </p>
        ) : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* identity */}
        <div className="space-y-5">
          <section className="panel p-4 sm:p-5">
            <h2 className="mb-3 flex items-center gap-2.5 font-display text-xl font-bold">
              <span className="seal seal-sm" aria-hidden>
                <Icon name="user" />
              </span>
              The {ROLE_DEFS.leader.name}
            </h2>
            <FormField label={`${ROLE_DEFS.leader.name}'s name`} hint="The name you are known by as head of government." error={touched ? daimyoErr : null}>
              <input className="field" value={daimyoName} maxLength={NAME_RULES.daimyoName.max} onChange={(e) => setDaimyoName(e.target.value)} placeholder="e.g. Arisawa Kenji" autoComplete="off" />
            </FormField>
            <fieldset className="mt-4">
              <legend className="mb-2 text-sm font-bold">Portrait</legend>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" role="radiogroup" aria-label="Portrait">
                {PORTRAITS.map((p) => {
                  const active = portrait === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setPortrait(p.id)}
                      className={cx('flex flex-col items-center gap-1 rounded-[3px] border p-1.5 transition-colors', active ? 'border-gold bg-gold/15' : 'border-gold/15 hover:border-gold/50')}
                    >
                      <Portrait id={p.id} accent={color} size={64} />
                      <span className="text-center text-[0.66rem] leading-tight text-muted">{p.name.replace('The ', '')}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </section>

          <section className="panel p-4 sm:p-5">
            <h2 className="mb-3 flex items-center gap-2.5 font-display text-xl font-bold">
              <span className="seal seal-sm" aria-hidden>
                <Icon name="clan" />
              </span>
              Your nation and flag
            </h2>
            <div className="flex gap-4">
              <div className="min-w-0 flex-1 space-y-4">
                <FormField label="Name of the nation" hint="Must be unique in the realm." error={touched ? clanErr : null}>
                  <input
                    className="field"
                    value={clanName}
                    maxLength={NAME_RULES.clanName.max}
                    onChange={(e) => {
                      setClanName(e.target.value);
                      // Suggest a tag from the name until the player types their own.
                      if (!tagEdited) setTag(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase());
                    }}
                    placeholder="e.g. Kurogane"
                    autoComplete="off"
                  />
                </FormField>
                <FormField label="Tag" hint={`${CLAN_RULES.tag.min}–${CLAN_RULES.tag.max} letters or numbers, shown beside every official's name.`} error={touched ? (tagErr ?? (tagTaken ? 'Another nation already uses that tag.' : null)) : tagTaken ? 'Another nation already uses that tag.' : null}>
                  <input
                    className="field num !w-32 uppercase tracking-widest"
                    value={tag}
                    maxLength={CLAN_RULES.tag.max}
                    onChange={(e) => {
                      setTagEdited(true);
                      setTag(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase());
                    }}
                    placeholder="KURO"
                    autoComplete="off"
                  />
                </FormField>
                <fieldset>
                  <legend className="mb-2 text-sm font-bold">Colour</legend>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Banner colour">
                    {BANNER_COLORS.map((c) => {
                      const taken = takenColors.has(c.id);
                      const active = color === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          aria-label={`${c.name}${taken ? ' (taken by another nation)' : ''}`}
                          title={taken ? `${c.name} — flown by another nation` : c.name}
                          disabled={taken}
                          onClick={() => setColor(c.id)}
                          className={cx('relative h-11 w-11 rounded-[3px] border-2 transition-transform', active ? 'scale-105 border-gold-bright' : 'border-ink-950', taken && 'cursor-not-allowed opacity-30')}
                          style={{ background: c.hex }}
                        >
                          {taken ? <span className="absolute inset-0 grid place-items-center text-lg text-parchment">✕</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="mb-2 text-sm font-bold">Crest</legend>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Banner crest">
                    {BANNER_MONS.map((m) => {
                      const active = mon === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          aria-label={m.name}
                          title={m.name}
                          onClick={() => setMon(m.id)}
                          className={cx('grid h-12 w-12 place-items-center rounded-[3px] border transition-colors', active ? 'border-gold bg-gold/15' : 'border-gold/15 hover:border-gold/50')}
                        >
                          <MonBadge color={color} mon={m.id} size={36} />
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              </div>
              <div className="flex shrink-0 flex-col items-center gap-2 pt-1">
                <Banner color={color} mon={mon} size={150} title="Preview of your flag" />
                <span className="text-[0.66rem] uppercase tracking-wider text-muted">Your flag</span>
              </div>
            </div>
          </section>
        </div>

        {/* province */}
        <div className="flex flex-col gap-5">
        <section className="panel p-4 sm:p-5">
          <h2 className="mb-3 flex items-center gap-2.5 font-display text-xl font-bold">
            <span className="seal seal-sm" aria-hidden>
              <Icon name="members" />
            </span>
            Who may join
          </h2>
          <fieldset>
            <legend className="sr-only">Recruitment</legend>
            <div className="grid gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label="Recruitment">
              {RECRUITMENT_MODES.map((m) => {
                const active = recruitment === m;
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setRecruitment(m)}
                    className={cx('flex items-start gap-3 rounded-[3px] border px-3 py-2 text-left transition-colors', active ? 'border-gold bg-gold/12' : 'border-gold/15 hover:border-gold/50')}
                  >
                    <span className={cx('mt-1 h-3.5 w-3.5 shrink-0 rounded-full border', active ? 'border-gold bg-gold' : 'border-gold/50')} aria-hidden />
                    <span className="leading-snug">
                      <span className="block font-display font-bold">{RECRUITMENT_DEFS[m].name}</span>
                      <span className="block text-xs text-muted">{RECRUITMENT_DEFS[m].summary}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <FormField label="Description" hint="Optional. What the nation stands for; shown to players looking for a nation.">
              <textarea className="field min-h-[76px]" value={description} maxLength={CLAN_RULES.descriptionMax} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Patient builders. We strike once, and well." />
            </FormField>
            <FormField label="Language" hint="Spoken in the nation channel.">
              <select className="field" value={language} onChange={(e) => setLanguage(e.target.value)}>
                {CLAN_LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <p className="mt-3 text-xs text-muted">You can change these later, and decide what each role in the nation may do.</p>
        </section>

        <section className="panel flex flex-1 flex-col p-4 sm:p-5">
          <h2 className="mb-1 flex items-center gap-2.5 font-display text-xl font-bold">
            <span className="seal seal-sm" aria-hidden>
              <Icon name="castle" />
            </span>
            The nation&apos;s capital
          </h2>
          <p className="mb-3 text-sm text-muted">
            Provinces marked <span className="font-bold text-vermilion-bright">+</span> are open. The nation begins with a castle, a farm, {WORLD.startingGarrison.ashigaru} ashigaru and {WORLD.startingGarrison.yari} yari, and{' '}
            {WORLD.protectionHours} game hours of protection.
          </p>
          {map.error && !map.data ? (
            <ErrorState message={map.error.message} onRetry={() => void map.refresh()} />
          ) : !map.data ? (
            <LoadingState label="Unrolling the map…" />
          ) : slots.length === 0 ? (
            <div className="paper p-5 text-center">
              <p className="font-display text-xl font-bold">The realm is full</p>
              <p className="mt-1 text-sm">Every open province has been claimed. A place will open when one falls back to the local warriors — check again soon.</p>
              <button type="button" className="btn btn-ink mt-3" onClick={() => void map.refresh()}>
                Look again
              </button>
            </div>
          ) : (
            <>
              <div className="relative aspect-[1000/940] w-full overflow-hidden rounded-[3px] border border-gold/25 lg:aspect-auto lg:min-h-[430px] lg:flex-1">
                <WorldMap provinces={map.data.provinces} clans={map.data.clans} selectedId={provinceId} onSelect={(id) => id && setProvinceId(id)} mode="found" />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Open provinces">
                {slots.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={p.id === provinceId}
                    onClick={() => setProvinceId(p.id)}
                    className={cx('btn btn-sm', p.id === provinceId && '!border-gold !bg-gold/20')}
                  >
                    <span className="font-display font-bold"><Glyph k={p.kanji} /></span> {p.name}
                  </button>
                ))}
              </div>
              {selected && def ? (
                <div className="paper mt-3 p-3.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-display text-xl font-bold">
                      <Glyph k={def.kanji} /> {selected.name}
                    </h3>
                    <span className="chip">{TERRAIN_INFO[selected.terrain].name}</span>
                  </div>
                  <p className="mt-1 font-display text-sm italic">{def.lore}</p>
                  <p className="num mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                    <span>{fmt(selected.population)} people</span>
                    {RESOURCE_KEYS.map((k) => (
                      <span key={k} title={`${RESOURCE_INFO[k].name} per hour`}>
                        <span className="font-display font-bold text-vermilion-deep" aria-hidden>
                          <Icon name={k} />
                        </span>{' '}
                        <span className="sr-only">{RESOURCE_INFO[k].name}</span>
                        {def.base[k]}/h
                      </span>
                    ))}
                  </p>
                  <p className="mt-1 text-xs text-ink-700">
                    {TERRAIN_INFO[selected.terrain].note} Borders {def.neighbors.map((n) => PROVINCE_BY_CODE[n]?.name).join(', ')}.
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">Tap an open province to see what it offers.</p>
              )}
            </>
          )}
        </section>
        </div>
      </div>

      {/* summary bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gold/25 bg-ink-950/95 backdrop-blur-md lg:static lg:mt-5 lg:rounded-[4px] lg:border" style={{ paddingBottom: 'var(--safe-bottom)' }}>
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-3 py-2.5 sm:px-5">
          <Portrait id={portrait} accent={color} size={48} className="hidden shrink-0 min-[400px]:block" />
          <Banner color={color} mon={mon} size={48} className="shrink-0" />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate font-display text-base font-bold">
              {clanName.trim() ? clanName.trim() : 'Unnamed nation'} {cleanTag ? <span className="num text-xs font-bold tracking-wider text-gold">[{cleanTag}]</span> : null}
            </div>
            <div className="truncate text-xs text-muted">
              {daimyoName.trim() || 'No name yet'} · {selected ? selected.name : 'no province chosen'}
            </div>
            {error ? (
              <div className="mt-0.5 text-xs font-bold text-vermilion-bright" role="alert">
                {error}
              </div>
            ) : null}
          </div>
          <ActionButton variant="primary" busy={busy} reason={touched ? blocked : null} onClick={() => void submit()} wrapperClassName="max-w-[12rem] shrink-0">
            {fallen ? 'Found the new capital' : 'Raise the flag'}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
