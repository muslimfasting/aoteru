'use client';

/**
 * Game session state shared by every screen inside /game.
 *
 * Loads the player, keeps the resource header current, and runs the realtime
 * loop: GET /api/sync is polled every few seconds while the tab is visible and
 * each event it returns is re-emitted on the client event bus.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClanSelfDTO, MeResponse, PlayerDTO, SyncResponse, WorldMetaDTO } from '@/game/api';
import type { ResourceBag } from '@/game/config';
import { ApiError, apiGet } from './api';
import { syncServerClock } from './clock';
import { bus, EVENTS } from './events';
import { useToast } from '@/components/toast';

const POLL_MS = 3000;
const MAX_BACKOFF_MS = 30000;

export interface GameState {
  player: PlayerDTO;
  clan: ClanSelfDTO;
  world: WorldMetaDTO;
  /** Live treasury; updated on every sync. */
  resources: ResourceBag;
  unread: number;
  setUnread: (n: number) => void;
  /** False while the realtime loop cannot reach the server. */
  online: boolean;
  refreshMe: () => Promise<void>;
}

const GameContext = createContext<GameState | null>(null);

export function useGame(): GameState {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used inside <GameProvider>');
  return ctx;
}

interface ProviderProps {
  children: React.ReactNode;
  /** Shown while the session is being loaded. */
  fallback: React.ReactNode;
  /** Shown if the session cannot be loaded for a reason other than auth. */
  renderError: (message: string, retry: () => void) => React.ReactNode;
}

export function GameProvider({ children, fallback, renderError }: ProviderProps) {
  const router = useRouter();
  const toast = useToast();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [world, setWorld] = useState<WorldMetaDTO | null>(null);
  const [resources, setResources] = useState<ResourceBag | null>(null);
  const [unread, setUnread] = useState(0);
  const [online, setOnline] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const redirected = useRef(false);

  const loadMe = useCallback(async () => {
    try {
      const res = await apiGet<MeResponse>('/api/player/me');
      syncServerClock(res.world.now);
      setMe(res);
      setWorld(res.world);
      if (res.clan) setResources(res.clan.resources);
      setUnread(res.unreadNotifications);
      setError(null);
      if (!res.clan || res.clan.status === 'fallen') {
        if (!redirected.current) {
          redirected.current = true;
          router.replace('/found');
        }
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        if (!redirected.current) {
          redirected.current = true;
          router.replace('/login');
        }
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not load your realm.');
    }
  }, [router]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  // Session expired anywhere → back to the gate.
  useEffect(() => {
    return bus.on('auth:unauthorized', () => {
      if (redirected.current) return;
      redirected.current = true;
      router.replace('/login');
    });
  }, [router]);

  // Keep the profile (income, army, rank) fresh when the world changes.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void loadMe();
      }, 400);
    };
    const offs = [...EVENTS.me, 'local:refresh' as const].map((name) => bus.on(name, trigger));
    return () => {
      offs.forEach((off) => off());
      if (timer) clearTimeout(timer);
    };
  }, [loadMe]);

  // Surface new notifications as toasts.
  useEffect(() => {
    return bus.on('notification:new', (payload) => {
      const title = typeof payload.title === 'string' ? payload.title : 'A messenger arrives';
      const body = typeof payload.body === 'string' ? payload.body : undefined;
      toast.info(title, body);
    });
  }, [toast]);

  // Realtime loop.
  const ready = me !== null && me.clan !== null && me.clan.status !== 'fallen';
  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    let cursor: number | null = null;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;

    const schedule = (ms: number) => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(poll, ms);
    };

    const poll = async () => {
      if (stopped || inFlight) return;
      if (document.visibilityState !== 'visible') return; // resumes on visibilitychange
      inFlight = true;
      try {
        const res = await apiGet<SyncResponse>(cursor === null ? '/api/sync' : `/api/sync?cursor=${cursor}`);
        if (stopped) return;
        cursor = res.cursor;
        failures = 0;
        syncServerClock(res.world.now);
        setWorld(res.world);
        if (res.resources) setResources(res.resources);
        setUnread(res.unreadNotifications);
        setOnline(true);
        for (const ev of res.events) bus.emit(ev.event, ev.payload ?? {});
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          stopped = true;
          return;
        }
        failures += 1;
        if (failures >= 2) setOnline(false);
      } finally {
        inFlight = false;
        schedule(failures > 0 ? Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** failures) : POLL_MS);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        failures = 0;
        void poll();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onVisibility);
    void poll();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onVisibility);
    };
  }, [ready]);

  const value = useMemo<GameState | null>(() => {
    if (!me || !me.clan || me.clan.status === 'fallen' || !world) return null;
    return {
      player: me.player,
      clan: me.clan,
      world,
      resources: resources ?? me.clan.resources,
      unread,
      setUnread,
      online,
      refreshMe: loadMe,
    };
  }, [me, world, resources, unread, online, loadMe]);

  if (error && !me) return <>{renderError(error, () => void loadMe())}</>;
  if (!value) return <>{fallback}</>;
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
