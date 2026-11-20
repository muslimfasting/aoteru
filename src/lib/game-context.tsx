'use client';

/**
 * Game session state shared by every screen inside /game.
 *
 * Loads the player — with or without a nation — keeps the treasury, the personal
 * purse and the unread counters current, and runs the realtime loop: GET
 * /api/sync is polled every few seconds while the tab is visible and each
 * event it returns is re-emitted on the client event bus.
 *
 * Two hooks read it:
 *  - `useSession()` for screens every player can open (discovery, messages,
 *    pillars, ranking, the map, settings). The nation may be null.
 *  - `useGame()` for screens that manage a nation. They are only rendered for
 *    members of an active nation (see `ClanGate`), so the nation is always there.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClanSelfDTO, MeResponse, MembershipDTO, PersonalDTO, PlayerDTO, SyncResponse, WorldMetaDTO } from '@/game/api';
import { PERMISSION_DEFS, type ClanPermission } from '@/game/clan';
import type { ResourceBag } from '@/game/config';
import { ApiError, apiGet } from './api';
import { syncServerClock } from './clock';
import { bus, EVENTS } from './events';
import { useToast } from '@/components/toast';

const POLL_MS = 3000;
const MAX_BACKOFF_MS = 30000;

export interface SessionState {
  player: PlayerDTO;
  /** The nation the player belongs to — even one that has fallen. Null without a nation. */
  clan: ClanSelfDTO | null;
  /** True when the player belongs to a nation that is still active. */
  hasClan: boolean;
  membership: MembershipDTO | null;
  personal: PersonalDTO;
  /** Live personal purse; updated on every sync. */
  purse: ResourceBag;
  world: WorldMetaDTO;
  /** Live National Treasury; updated on every sync. Null without a nation. */
  resources: ResourceBag | null;
  /** Unread reports. */
  unread: number;
  setUnread: (n: number) => void;
  /** Unread private messages plus unread messages in the nation channel. */
  unreadMessages: number;
  setUnreadMessages: (n: number) => void;
  pendingInvitations: number;
  /** False while the realtime loop cannot reach the server. */
  online: boolean;
  /** Does the player's role hold this permission in their nation? */
  can: (permission: ClanPermission) => boolean;
  /** Why the player may not do something that needs this permission, or null if they may. */
  lacks: (permission: ClanPermission) => string | null;
  refreshMe: () => Promise<void>;
}

export interface GameState extends SessionState {
  clan: ClanSelfDTO;
  membership: MembershipDTO;
  resources: ResourceBag;
}

const GameContext = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useSession must be used inside <GameProvider>');
  return ctx;
}

/** For screens that manage a nation. Throws if rendered without one: wrap such screens in the nation gate. */
export function useGame(): GameState {
  const ctx = useSession();
  if (!ctx.clan || !ctx.membership || !ctx.resources) throw new Error('This screen needs a nation');
  return ctx as GameState;
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
  const [purse, setPurse] = useState<ResourceBag | null>(null);
  const [unread, setUnread] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [online, setOnline] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const redirected = useRef(false);

  const loadMe = useCallback(async () => {
    try {
      const res = await apiGet<MeResponse>('/api/player/me');
      syncServerClock(res.world.now);
      setMe(res);
      setWorld(res.world);
      setResources(res.clan ? res.clan.resources : null);
      setPurse(res.personal.purse);
      setUnread(res.unreadNotifications);
      setUnreadMessages(res.unreadMessages);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        if (!redirected.current) {
          redirected.current = true;
          router.replace('/login');
        }
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not load the game.');
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

  // Keep the profile (income, army, rank, membership) fresh when the world changes.
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

  // The purse arrives with its own event.
  useEffect(() => {
    return bus.on('purse:updated', (payload) => {
      const next = payload.purse as ResourceBag | undefined;
      if (next && typeof next.gold === 'number') setPurse(next);
    });
  }, []);

  // Surface new notifications as toasts.
  useEffect(() => {
    return bus.on('notification:new', (payload) => {
      const title = typeof payload.title === 'string' ? payload.title : 'A messenger arrives';
      const body = typeof payload.body === 'string' ? payload.body : undefined;
      toast.info(title, body);
    });
  }, [toast]);

  // Realtime loop.
  const ready = me !== null;
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
        setResources(res.resources);
        setPurse(res.purse);
        setUnread(res.unreadNotifications);
        setUnreadMessages(res.unreadMessages);
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

  const value = useMemo<SessionState | null>(() => {
    if (!me || !world) return null;
    const membership = me.clan ? me.membership : null;
    const can = (permission: ClanPermission) => !!membership && membership.permissions.includes(permission);
    const lacks = (permission: ClanPermission) => {
      if (!membership) return 'Join or found a nation first';
      if (membership.permissions.includes(permission)) return null;
      return `Needs the ${PERMISSION_DEFS[permission].name} permission (your role: ${membership.roleName})`;
    };
    return {
      player: me.player,
      clan: me.clan,
      hasClan: !!me.clan && me.clan.status === 'active',
      membership,
      personal: me.personal,
      purse: purse ?? me.personal.purse,
      world,
      resources: me.clan ? (resources ?? me.clan.resources) : null,
      unread,
      setUnread,
      unreadMessages,
      setUnreadMessages,
      pendingInvitations: me.pendingInvitations,
      online,
      can,
      lacks,
      refreshMe: loadMe,
    };
  }, [me, world, resources, purse, unread, unreadMessages, online, loadMe]);

  if (error && !me) return <>{renderError(error, () => void loadMe())}</>;
  if (!value) return <>{fallback}</>;
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
