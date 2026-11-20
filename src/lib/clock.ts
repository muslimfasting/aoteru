'use client';

/**
 * Server clock.
 *
 * Countdowns must follow the server's clock, not the device's. Every response
 * that carries `world.now` re-synchronises the offset; `useNow()` then ticks
 * once per second for every countdown on screen through a single interval.
 */
import { useSyncExternalStore } from 'react';

let offsetMs = 0;
let current = Math.floor(Date.now() / 1000);
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function tick() {
  const next = Math.floor((Date.now() + offsetMs) / 1000);
  if (next !== current) {
    current = next;
    for (const l of listeners) l();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) timer = setInterval(tick, 250);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Align the local clock with the server's `world.now`. */
export function syncServerClock(serverNowIso: string): void {
  const server = Date.parse(serverNowIso);
  if (!Number.isFinite(server)) return;
  offsetMs = server - Date.now();
  tick();
}

/** Current server time in milliseconds (not reactive). */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** Current server time in milliseconds, re-rendering once per second. */
export function useNow(): number {
  const seconds = useSyncExternalStore(
    subscribe,
    () => current,
    () => 0,
  );
  return seconds * 1000;
}
