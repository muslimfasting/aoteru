'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, errorMessage } from './api';
import { bus, type BusEvent } from './events';
import { useToast } from '@/components/toast';

export interface ApiState<T> {
  data: T | undefined;
  error: Error | null;
  /** First load, nothing to show yet. */
  loading: boolean;
  /** Refetching while stale data stays on screen. */
  refreshing: boolean;
  refresh: () => Promise<void>;
  setData: (data: T) => void;
}

/**
 * Load a GET endpoint and keep it fresh.
 * Refetches when the path changes, when any of `events` arrives on the bus,
 * and after any local mutation (`local:refresh`). Stale data stays visible
 * while a refetch is in flight.
 */
export function useApi<T>(path: string | null, events: readonly BusEvent[] = []): ApiState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const [refreshing, setRefreshing] = useState(false);
  const requestId = useRef(0);
  const pathRef = useRef(path);
  const hasData = useRef(false);

  const load = useCallback(async (target: string | null) => {
    if (target === null) return;
    const id = ++requestId.current;
    if (hasData.current) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await apiGet<T>(target);
      if (id !== requestId.current) return;
      hasData.current = true;
      setDataState(result);
      setError(null);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err : new Error(errorMessage(err)));
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    pathRef.current = path;
    hasData.current = false;
    setDataState(undefined);
    setError(null);
    if (path === null) {
      requestId.current++;
      setLoading(false);
      return;
    }
    void load(path);
  }, [path, load]);

  const eventsKey = events.join('|');
  useEffect(() => {
    if (path === null) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void load(pathRef.current);
      }, 120);
    };
    const names = [...(eventsKey ? (eventsKey.split('|') as BusEvent[]) : []), 'local:refresh' as BusEvent];
    const offs = names.map((name) => bus.on(name, trigger));
    return () => {
      offs.forEach((off) => off());
      if (timer) clearTimeout(timer);
    };
  }, [path, eventsKey, load]);

  const refresh = useCallback(() => load(pathRef.current), [load]);
  const setData = useCallback((next: T) => {
    requestId.current++;
    hasData.current = true;
    setDataState(next);
    setError(null);
    setLoading(false);
    setRefreshing(false);
  }, []);

  return { data, error, loading, refreshing, refresh, setData };
}

/**
 * Run a mutation with consistent feedback: a busy flag, a success toast, the
 * server's message on failure, and a refresh of everything on screen.
 */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, opts: { success?: string | ((result: T) => string); silent?: boolean } = {}): Promise<T | undefined> => {
      if (busyRef.current) return undefined;
      busyRef.current = true;
      setBusy(true);
      try {
        const result = await fn();
        if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(result) : opts.success);
        bus.emit('local:refresh', {});
        return result;
      } catch (err) {
        if (!opts.silent) toast.error(errorMessage(err));
        return undefined;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [toast],
  );

  return { run, busy };
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** True from the `lg` breakpoint up, where side panels replace bottom sheets. */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)');
}

export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
