'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { ChatMessageDTO, ChatResponse, NotificationDTO, NotificationsResponse } from '@/game/api';
import { WORLD, bannerHex } from '@/game/config';
import { ActionButton, EmptyState, ErrorState, LoadingState, PageHeader, Panel, Tabs } from '@/components/ui';
import { apiPost } from '@/lib/api';
import { useNow } from '@/lib/clock';
import { EVENTS } from '@/lib/events';
import { cx, fmtTime, timeAgo } from '@/lib/format';
import { useGame } from '@/lib/game-context';
import { useAction, useApi, useIsDesktop } from '@/lib/hooks';

import { Glyph } from '@/components/icons';
type Tab = 'notifications' | 'chat';

const TYPE_KANJI: Record<string, string> = {
  battle: '戦',
  building: '築',
  recruitment: '募',
  war: '敵',
  peace: '和',
  espionage: '忍',
  event: '事',
  province: '国',
  system: '報',
};

export default function MessagesPage() {
  const isDesktop = useIsDesktop();
  const { unread } = useGame();
  const [tab, setTab] = useState<Tab>('notifications');

  return (
    <div>
      <PageHeader kanji="報" title="Messages" subtitle="Reports from your retainers, and the talk of the realm." />
      {isDesktop ? (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5">
          <Notifications />
          <Chat />
        </div>
      ) : (
        <>
          <Tabs<Tab>
            className="mb-3"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'notifications', label: 'Reports', badge: unread || null },
              { id: 'chat', label: 'World chat' },
            ]}
          />
          {tab === 'notifications' ? <Notifications /> : <Chat fullScreen />}
        </>
      )}
    </div>
  );
}

function Notifications() {
  const state = useApi<NotificationsResponse>('/api/notifications', EVENTS.notifications);
  const { setUnread } = useGame();
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
      kanji="報"
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
        <EmptyState kanji="静" title="All is quiet">
          News of battles, finished buildings, envoys and events will arrive here.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-gold/10 lg:max-h-[calc(100dvh-16rem)] lg:overflow-y-auto">
          {state.data.notifications.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => open(n)} className={cx('flex min-h-[60px] w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-parchment/5', !n.readAt && 'bg-gold/8')}>
                <span className={cx('seal seal-sm mt-0.5', n.readAt ? 'seal-ink' : '')} aria-hidden>
                  <Glyph k={TYPE_KANJI[n.type] ?? '報'} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={cx('font-display text-[0.98rem] leading-snug', n.readAt ? 'text-parchment/80' : 'font-bold')}>{n.title}</span>
                    <span className="num shrink-0 text-[0.7rem] text-muted">{now ? timeAgo(n.createdAt, now) : ''}</span>
                  </span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-muted">{n.body}</span>
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

function Chat({ fullScreen }: { fullScreen?: boolean }) {
  const state = useApi<ChatResponse>('/api/chat', EVENTS.chat);
  const { clan } = useGame();
  const action = useAction();
  const [body, setBody] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const messages = state.data?.messages ?? [];
  const lastId = messages[messages.length - 1]?.id;

  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  const send = async () => {
    const text = body.trim();
    if (!text) return;
    const res = await action.run(() => apiPost<{ message: ChatMessageDTO }>('/api/chat', { body: text }));
    if (res) {
      setBody('');
      stick.current = true;
      if (state.data && !state.data.messages.some((m) => m.id === res.message.id)) state.setData({ ...state.data, messages: [...state.data.messages, res.message] });
    }
  };

  return (
    <Panel title="World chat" kanji="談" bodyClassName="p-0" className="flex flex-col">
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className={cx('overflow-y-auto px-4 py-3', fullScreen ? 'h-[calc(100dvh-27.5rem-var(--safe-bottom))] min-h-[220px]' : 'h-[calc(100dvh-20.5rem)] min-h-[260px]')}
        aria-live="polite"
      >
        {state.error && !state.data ? (
          <ErrorState message={state.error.message} onRetry={() => void state.refresh()} />
        ) : !state.data ? (
          <LoadingState />
        ) : messages.length === 0 ? (
          <EmptyState kanji="談" title="The hall is silent">
            Be the first to speak. Every clan in the realm can read what is said here.
          </EmptyState>
        ) : (
          <ol className="space-y-3">
            {messages.map((m) => {
              const mine = m.clanId === clan.id;
              return (
                <li key={m.id} className={cx('flex gap-2.5', mine && 'flex-row-reverse')}>
                  <span className="mt-1 h-7 w-1.5 shrink-0 rounded-sm" style={{ background: bannerHex(m.bannerColor) }} aria-hidden />
                  <div className={cx('min-w-0 max-w-[85%]', mine && 'text-right')}>
                    <div className="text-[0.72rem] text-muted">
                      <span className="font-display text-sm font-bold text-parchment">{m.clanName}</span> · {m.nickname} · <span className="num">{fmtTime(m.createdAt)}</span>
                    </div>
                    <p className={cx('mt-0.5 inline-block whitespace-pre-wrap break-words rounded-[3px] border px-3 py-1.5 text-left text-sm leading-relaxed', mine ? 'border-gold/40 bg-gold/12' : 'border-gold/15 bg-ink-800/70')}>
                      {m.body}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <form
        className="flex items-start gap-2 border-t border-gold/20 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor="chat-input">
          Message to the realm
        </label>
        <input id="chat-input" className="field flex-1" value={body} maxLength={WORLD.maxChatLength} onChange={(e) => setBody(e.target.value)} placeholder="Speak to the realm…" autoComplete="off" />
        <ActionButton variant="gold" type="submit" busy={action.busy} reason={body.trim() ? null : undefined}>
          Send
        </ActionButton>
      </form>
      <p className="num px-3 pb-2 text-right text-[0.68rem] text-faint">
        {body.length} / {WORLD.maxChatLength}
      </p>
    </Panel>
  );
}
