'use client';

/**
 * Messages: reports from the realm, and three chat channels — World (everyone),
 * Nation (officials of the viewer's nation) and Private (one other player).
 * `/game/messages?with=<playerId>` opens the private thread with that player.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import type { ChatMessageDTO, ChatResponse, ChatThreadsResponse, NotificationDTO, NotificationsResponse, PlayerCardDTO, PlayerSearchResponse } from '@/game/api';
import { WORLD, bannerHex } from '@/game/config';
import { ClanTag, PlayerLink } from '@/components/clan';
import { Icon, type IconName } from '@/components/icons';
import { Portrait } from '@/components/Portrait';
import { ActionButton, Dialog, EmptyState, ErrorState, LoadingState, PageHeader, Panel, Tabs } from '@/components/ui';
import { apiPost } from '@/lib/api';
import { useNow } from '@/lib/clock';
import { EVENTS } from '@/lib/events';
import { cx, fmtTime, timeAgo } from '@/lib/format';
import { useSession } from '@/lib/game-context';
import { useAction, useApi, useDebounced, useIsDesktop } from '@/lib/hooks';

type Tab = 'reports' | 'world' | 'clan' | 'private';

const TYPE_ICON: Record<string, IconName> = {
  battle: 'military',
  building: 'build',
  recruitment: 'people',
  war: 'alert',
  peace: 'diplomacy',
  espionage: 'intel',
  event: 'scroll',
  province: 'province',
  system: 'messages',
  clan: 'clan',
  treasury: 'treasury',
  pillar: 'pillars',
};

export default function MessagesPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <MessagesScreen />
    </Suspense>
  );
}

function MessagesScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const isDesktop = useIsDesktop();
  const session = useSession();
  const { setUnreadMessages } = session;
  const threads = useApi<ChatThreadsResponse>('/api/chat/threads', EVENTS.chat);
  const withId = params.get('with');
  const wanted = params.get('channel');
  const [tab, setTab] = useState<Tab>(withId ? 'private' : wanted === 'clan' || wanted === 'private' || wanted === 'world' ? wanted : 'reports');

  // A deep link to a thread always shows the private channel.
  useEffect(() => {
    if (withId) setTab('private');
  }, [withId]);

  const dmUnread = threads.data?.threads.reduce((sum, t) => sum + t.unread, 0) ?? 0;
  const clanUnread = threads.data?.clanUnread ?? 0;
  useEffect(() => {
    if (threads.data) setUnreadMessages(dmUnread + clanUnread);
  }, [threads.data, dmUnread, clanUnread, setUnreadMessages]);

  const choose = (next: Tab) => {
    setTab(next);
    // Leaving the private channel (or going back to its list) drops the open thread from the address.
    if (withId) router.replace('/game/messages', { scroll: false });
  };
  const chatTab: Exclude<Tab, 'reports'> = tab === 'reports' ? 'world' : tab;
  const refreshThreads = () => void threads.refresh();

  const chat = (current: Exclude<Tab, 'reports'>, fullScreen: boolean) =>
    current === 'world' ? (
      <ChatLog key="world" path="/api/chat?channel=world" send={(body) => ({ channel: 'world', body })} variant="world" fullScreen={fullScreen} placeholder="Speak to the realm…" emptyTitle="The hall is silent" emptyText="Be the first to speak. Every player in the realm can read what is said here." />
    ) : current === 'clan' ? (
      session.clan ? (
        <ChatLog
          key="clan"
          path="/api/chat?channel=clan"
          send={(body) => ({ channel: 'clan', body })}
          variant="clan"
          fullScreen={fullScreen}
          onLoaded={refreshThreads}
          placeholder={`Speak to ${session.clan.name}…`}
          emptyTitle="No word in the nation channel yet"
          emptyText="Only officials of your nation can read and write here."
        />
      ) : (
        <EmptyState icon="clan" title="You have no nation channel" className="!py-10">
          The nation channel is for a nation&apos;s own officials.{' '}
          <Link href="/game/clans" className="tap-link text-gold">
            Find a nation
          </Link>{' '}
          to get one.
        </EmptyState>
      )
    ) : withId ? (
      <Thread key={withId} withId={withId} fullScreen={fullScreen} onBack={() => router.replace('/game/messages?channel=private', { scroll: false })} onLoaded={refreshThreads} />
    ) : (
      <ThreadList state={threads} onOpen={(id) => router.replace(`/game/messages?with=${id}`, { scroll: false })} />
    );

  return (
    <div>
      <PageHeader icon="messages" title="Messages" subtitle={isDesktop ? "Reports from the realm, the talk of the world, your nation's channel and private letters." : undefined} />
      {isDesktop ? (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5">
          <Notifications />
          <section className="panel flex min-w-0 flex-col">
            <Tabs<Exclude<Tab, 'reports'>>
              className="px-2"
              value={chatTab}
              onChange={choose}
              tabs={[
                { id: 'world', label: 'World' },
                { id: 'clan', label: 'Nation', badge: clanUnread || null },
                { id: 'private', label: 'Private', badge: dmUnread || null },
              ]}
            />
            {chat(chatTab, false)}
          </section>
        </div>
      ) : (
        <>
          <Tabs<Tab>
            className="mb-3"
            value={tab}
            onChange={choose}
            tabs={[
              { id: 'reports', label: 'Reports', badge: session.unread || null },
              { id: 'world', label: 'World' },
              { id: 'clan', label: 'Nation', badge: clanUnread || null },
              { id: 'private', label: 'Private', badge: dmUnread || null },
            ]}
          />
          {tab === 'reports' ? <Notifications /> : <section className="panel flex min-w-0 flex-col">{chat(tab, true)}</section>}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

function Notifications() {
  const state = useApi<NotificationsResponse>('/api/notifications', EVENTS.notifications);
  const { setUnread } = useSession();
  const router = useRouter();
  const action = useAction();
  const now = useNow();

  useEffect(() => {
    if (state.data) setUnread(state.data.unread);
  }, [state.data, setUnread]);

  const markRead = async (ids?: string[]) => {
    const res = await action.run(() => apiPost<NotificationsResponse>('/api/notifications/read', ids ? { ids } : {}), { silent: true });
    if (res) state.setData(res);
  };

  const open = (n: NotificationDTO) => {
    if (!n.readAt) void markRead([n.id]);
    if (n.link) router.push(n.link);
  };

  return (
    <Panel
      title="Reports"
      icon="messages"
      bodyClassName="p-0"
      action={
        state.data && state.data.unread > 0 ? (
          <button type="button" className="btn btn-sm" onClick={() => void markRead()} disabled={action.busy}>
            Mark all read
          </button>
        ) : undefined
      }
    >
      {state.error && !state.data ? (
        <ErrorState message={state.error.message} onRetry={() => void state.refresh()} />
      ) : !state.data ? (
        <LoadingState />
      ) : state.data.notifications.length === 0 ? (
        <EmptyState icon="messages" title="All is quiet">
          News of battles, finished buildings, envoys, matters of state and events will arrive here.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-gold/10 lg:max-h-[calc(100dvh-16rem)] lg:overflow-y-auto">
          {state.data.notifications.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => open(n)} className={cx('flex min-h-[60px] w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-parchment/5', !n.readAt && 'bg-gold/8')}>
                <span className={cx('seal seal-sm mt-0.5', n.readAt ? 'seal-ink' : '')} aria-hidden>
                  <Icon name={TYPE_ICON[n.type] ?? 'messages'} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={cx('font-display text-[0.98rem] leading-snug', n.readAt ? 'text-parchment/80' : 'font-bold')}>{n.title}</span>
                    <span className="num shrink-0 text-[0.7rem] text-muted">{now ? timeAgo(n.createdAt, now) : ''}</span>
                  </span>
                  <span className="mt-0.5 block break-words text-sm leading-relaxed text-muted">{n.body}</span>
                  {n.link ? <span className="mt-1 inline-block text-xs text-gold underline underline-offset-2">Open</span> : null}
                </span>
                {!n.readAt ? <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-vermilion-bright" aria-label="Unread" /> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// A chat channel: message list and composer
// ---------------------------------------------------------------------------

function ChatLog({
  path,
  send,
  variant,
  fullScreen,
  placeholder,
  emptyTitle,
  emptyText,
  onLoaded,
  header,
}: {
  path: string;
  send: (body: string) => Record<string, unknown>;
  variant: 'world' | 'clan' | 'dm';
  fullScreen: boolean;
  placeholder: string;
  emptyTitle: string;
  emptyText: string;
  /** Called whenever the newest message changes (the thread has been marked read by loading it). */
  onLoaded?: () => void;
  /** Drawn above the messages; receives the loaded channel (for a private thread: who it is with). */
  header?: (data: ChatResponse | undefined, error: Error | null) => React.ReactNode;
}) {
  const state = useApi<ChatResponse>(path, EVENTS.chat);
  const action = useAction();
  const [body, setBody] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;
  const messages = state.data?.messages ?? [];
  const lastId = messages[messages.length - 1]?.id;
  const ready = state.data !== undefined;

  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
    if (ready) loaded.current?.();
  }, [lastId, ready]);

  const post = async () => {
    const text = body.trim();
    if (!text) return;
    const res = await action.run(() => apiPost<{ message: ChatMessageDTO }>('/api/chat', send(text)));
    if (res) {
      setBody('');
      stick.current = true;
      if (state.data && !state.data.messages.some((m) => m.id === res.message.id)) state.setData({ ...state.data, messages: [...state.data.messages, res.message] });
    }
  };

  const inputId = `chat-input-${variant}`;
  return (
    <>
      {header ? header(state.data, state.error) : null}
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className={cx(
          'overflow-y-auto px-3.5 py-3 sm:px-4',
          fullScreen
            ? header
              ? 'h-[calc(100dvh-31.5rem-var(--safe-bottom))] min-h-[150px]'
              : 'h-[calc(100dvh-27.5rem-var(--safe-bottom))] min-h-[180px]'
            : header
              ? 'h-[calc(100dvh-27.5rem)] min-h-[240px]'
              : 'h-[calc(100dvh-23.5rem)] min-h-[260px]',
        )}
        aria-live="polite"
      >
        {state.error && !state.data ? (
          <ErrorState message={state.error.message} onRetry={() => void state.refresh()} />
        ) : !state.data ? (
          <LoadingState />
        ) : messages.length === 0 ? (
          <EmptyState icon="chat" title={emptyTitle}>
            {emptyText}
          </EmptyState>
        ) : (
          <ol className="space-y-3">
            {messages.map((m) => (
              <Message key={m.id} m={m} variant={variant} />
            ))}
          </ol>
        )}
      </div>
      <form
        className="flex items-start gap-2 border-t border-gold/20 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void post();
        }}
      >
        <label className="sr-only" htmlFor={inputId}>
          {placeholder}
        </label>
        <input id={inputId} className="field min-w-0 flex-1" value={body} maxLength={WORLD.maxChatLength} onChange={(e) => setBody(e.target.value)} placeholder={placeholder} autoComplete="off" />
        <ActionButton variant="gold" type="submit" busy={action.busy} disabled={!body.trim()}>
          Send
        </ActionButton>
      </form>
      <p className="num px-3 pb-2 text-right text-[0.68rem] text-faint">
        {body.length} / {WORLD.maxChatLength}
      </p>
    </>
  );
}

function Message({ m, variant }: { m: ChatMessageDTO; variant: 'world' | 'clan' | 'dm' }) {
  return (
    <li className={cx('flex gap-2.5', m.mine && 'flex-row-reverse')}>
      {variant === 'dm' ? null : <span className="mt-1 h-7 w-1.5 shrink-0 rounded-sm" style={{ background: bannerHex(m.bannerColor) }} aria-hidden />}
      <div className={cx('min-w-0 max-w-[85%]', m.mine && 'text-right')}>
        <div className="text-[0.72rem] text-muted">
          {variant === 'world' ? (
            <>
              <span className="font-display text-sm font-bold text-parchment">{m.clanName}</span> {m.clanTag ? <ClanTag tag={m.clanTag} /> : null} ·{' '}
            </>
          ) : null}
          {variant === 'dm' ? null : (
            <>
              <PlayerLink id={m.mine ? null : m.playerId} className={variant === 'clan' ? 'font-display text-sm font-bold text-parchment' : undefined}>
                {m.mine ? 'You' : m.nickname}
              </PlayerLink>{' '}
              ·{' '}
            </>
          )}
          <span className="num">{fmtTime(m.createdAt)}</span>
        </div>
        <p className={cx('mt-0.5 inline-block whitespace-pre-wrap break-words rounded-[3px] border px-3 py-1.5 text-left text-sm leading-relaxed', m.mine ? 'border-gold/40 bg-gold/12' : 'border-gold/15 bg-ink-800/70')}>{m.body}</p>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Private messages
// ---------------------------------------------------------------------------

function Thread({ withId, fullScreen, onBack, onLoaded }: { withId: string; fullScreen: boolean; onBack: () => void; onLoaded: () => void }) {
  return (
    <ChatLog
      path={`/api/chat?channel=dm&with=${withId}`}
      send={(body) => ({ channel: 'dm', to: withId, body })}
      variant="dm"
      fullScreen={fullScreen}
      onLoaded={onLoaded}
      placeholder="Write a private message…"
      emptyTitle="No letters yet"
      emptyText="Only the two of you can read this conversation."
      header={(data, error) => {
        const other = data?.with ?? null;
        return (
          <div className="flex items-center gap-2 border-b border-gold/15 px-2 py-2">
            <button type="button" className="btn btn-ghost btn-sm !min-h-[44px] shrink-0" onClick={onBack} aria-label="Back to conversations">
              ←
            </button>
            {other ? (
              <>
                <Portrait id={other.portrait} accent={other.bannerColor ?? undefined} size={38} className="shrink-0" />
                <div className="min-w-0 flex-1 leading-tight">
                  <PlayerLink id={other.playerId} className="block truncate font-display font-bold">
                    {other.nickname}
                  </PlayerLink>
                  <div className="truncate text-xs text-muted">
                    {other.clanName ? (
                      <>
                        {other.roleName} · {other.clanName} <ClanTag tag={other.clanTag} />
                      </>
                    ) : (
                      'Without a nation'
                    )}
                  </div>
                </div>
              </>
            ) : error ? (
              <span className="text-sm text-vermilion-bright">This conversation cannot be opened.</span>
            ) : (
              <span className="text-sm text-muted">Opening the letter box…</span>
            )}
          </div>
        );
      }}
    />
  );
}

function ThreadList({ state, onOpen }: { state: { data: ChatThreadsResponse | undefined; error: Error | null; refresh: () => Promise<void> }; onOpen: (playerId: string) => void }) {
  const [composing, setComposing] = useState(false);
  const now = useNow();
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-gold/15 px-4 py-3">
        <div className="min-w-0 leading-tight">
          <h2 className="font-display text-[1.02rem] font-bold">Private messages</h2>
          <p className="text-xs text-muted">Between you and one other player.</p>
        </div>
        <button type="button" className="btn btn-sm btn-gold shrink-0" onClick={() => setComposing(true)}>
          <Icon name="plus" /> New message
        </button>
      </div>
      {state.error && !state.data ? (
        <ErrorState message={state.error.message} onRetry={() => void state.refresh()} />
      ) : !state.data ? (
        <LoadingState />
      ) : state.data.threads.length === 0 ? (
        <EmptyState icon="mail" title="No conversations yet" className="!py-10">
          Write to any player: an ally to plan with, a rival to bargain with, a newcomer to welcome.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-gold/10 lg:max-h-[calc(100dvh-21rem)] lg:overflow-y-auto">
          {state.data.threads.map((t) => (
            <li key={t.with.playerId}>
              <button type="button" onClick={() => onOpen(t.with.playerId)} className={cx('flex min-h-[64px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-parchment/5', t.unread > 0 && 'bg-gold/8')}>
                <Portrait id={t.with.portrait} accent={t.with.bannerColor ?? undefined} size={42} className="shrink-0" />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={cx('truncate font-display text-[1rem]', t.unread > 0 ? 'font-bold' : 'text-parchment/90')}>
                      {t.with.nickname} {t.with.clanTag ? <ClanTag tag={t.with.clanTag} /> : null}
                    </span>
                    <span className="num shrink-0 text-[0.7rem] text-muted">{now ? timeAgo(t.lastMessage.createdAt, now) : ''}</span>
                  </span>
                  <span className={cx('mt-0.5 block truncate text-sm', t.unread > 0 ? 'text-parchment' : 'text-muted')}>
                    {t.lastMessage.mine ? 'You: ' : ''}
                    {t.lastMessage.body}
                  </span>
                </span>
                {t.unread > 0 ? (
                  <span className="num shrink-0 rounded-sm bg-vermilion px-1.5 py-0.5 text-[0.65rem] font-bold text-parchment-light" aria-label={`${t.unread} unread`}>
                    {t.unread}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {composing ? (
        <NewMessage
          onClose={() => setComposing(false)}
          onPick={(p) => {
            setComposing(false);
            onOpen(p.playerId);
          }}
        />
      ) : null}
    </>
  );
}

function NewMessage({ onClose, onPick }: { onClose: () => void; onPick: (player: PlayerCardDTO) => void }) {
  const [search, setSearch] = useState('');
  const query = useDebounced(search, 250);
  const state = useApi<PlayerSearchResponse>(`/api/players?search=${encodeURIComponent(query.trim())}`);
  return (
    <Dialog open onClose={onClose} title="New message" icon="mail">
      <label className="mb-1 block text-sm font-bold" htmlFor="player-search">
        Who do you want to write to?
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden>
          <Icon name="search" />
        </span>
        <input id="player-search" className="field !pl-10" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search players by nickname" autoComplete="off" autoFocus />
      </div>
      <div className="mt-3 min-h-[12rem]">
        {state.error && !state.data ? (
          <ErrorState message={state.error.message} onRetry={() => void state.refresh()} className="!py-6" />
        ) : !state.data ? (
          <LoadingState className="!py-6" />
        ) : state.data.players.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">{query.trim() ? `No player is called "${query.trim()}".` : 'No other players yet.'}</p>
        ) : (
          <>
            {!query.trim() ? <p className="mb-1.5 text-xs text-muted">Newest players</p> : null}
            <ul className="divide-y divide-gold/10 rounded-[3px] border border-gold/15">
              {state.data.players.map((p) => (
                <li key={p.playerId}>
                  <button type="button" onClick={() => onPick(p)} className="flex min-h-[56px] w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-parchment/5">
                    <Portrait id={p.portrait} accent={p.bannerColor ?? undefined} size={38} className="shrink-0" />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate font-display font-bold">{p.nickname}</span>
                      <span className="block truncate text-xs text-muted">
                        {p.clanName ? (
                          <>
                            {p.roleName} · {p.clanName} <ClanTag tag={p.clanTag} />
                          </>
                        ) : (
                          'Without a nation'
                        )}{' '}
                        · level {p.level}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Dialog>
  );
}
