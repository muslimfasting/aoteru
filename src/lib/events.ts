/**
 * Client event bus.
 *
 * Realtime events from the server (delivered by polling /api/sync today, by a
 * socket later) are re-emitted here under their own names. Screens subscribe
 * by event name and refetch what they show.
 */
import type { RealtimeEventName } from '@/game/api';

export type BusEvent = RealtimeEventName | 'auth:unauthorized' | 'local:refresh';
type Handler = (payload: Record<string, unknown>) => void;

class EventBus {
  private handlers = new Map<string, Set<Handler>>();

  on(event: BusEvent, handler: Handler): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  emit(event: BusEvent, payload: Record<string, unknown>): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[bus] handler for ${event} failed`, err);
      }
    }
  }
}

export const bus = new EventBus();

/** Event groups that screens commonly listen to. */
export const EVENTS = {
  map: ['world:province_updated', 'army:updated', 'battle:started', 'battle:completed', 'world:event', 'diplomacy:updated'],
  army: ['army:updated', 'recruitment:completed', 'battle:started', 'battle:completed', 'world:province_updated'],
  province: ['building:completed', 'recruitment:completed', 'world:province_updated', 'army:updated', 'battle:completed', 'world:tick', 'espionage:completed'],
  me: ['resource:updated', 'world:province_updated', 'army:updated', 'recruitment:completed', 'building:completed', 'battle:completed', 'world:tick'],
  battles: ['battle:started', 'battle:completed'],
  pillars: ['pillars:updated'],
  diplomacy: ['diplomacy:proposal', 'diplomacy:updated', 'world:province_updated'],
  intel: ['espionage:completed'],
  notifications: ['notification:new'],
  chat: ['chat:message'],
  ranking: ['world:province_updated', 'world:tick'],
} as const satisfies Record<string, readonly BusEvent[]>;
