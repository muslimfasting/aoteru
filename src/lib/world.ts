import type { BattleSummaryDTO, WorldMetaDTO } from '@/game/api';
import { hourName } from './format';

/** Game calendar date of a real timestamp, derived from the world clock. */
export function gameDate(world: WorldMetaDTO, iso: string): { day: number; hour: number } {
  const at = Date.parse(iso);
  const tickStart = Date.parse(world.nextTickAt) - world.tickIntervalMs;
  const offset = Math.floor((at - tickStart) / world.tickIntervalMs);
  const tick = Math.max(0, world.tickNumber + offset);
  return { day: Math.floor(tick / 24) + 1, hour: ((tick % 24) + 24) % 24 };
}

export function gameDateText(world: WorldMetaDTO, iso: string): string {
  const d = gameDate(world, iso);
  return `Day ${d.day}, hour of the ${hourName(d.hour)}`;
}

export type ViewerResult = 'pending' | 'won' | 'lost' | 'draw' | 'cancelled';

/** Battle outcome from the viewer's side of the field. */
export function viewerResult(b: BattleSummaryDTO): ViewerResult {
  if (b.status === 'pending') return 'pending';
  if (b.status === 'cancelled') return 'cancelled';
  if (b.winner === 'none' || b.winner === null) return 'draw';
  return b.winner === b.role ? 'won' : 'lost';
}

export const RESULT_STYLE: Record<ViewerResult, { label: string; chip: string; kanji: string }> = {
  pending: { label: 'In battle', chip: 'chip chip-red', kanji: '戦' },
  won: { label: 'Won', chip: 'chip', kanji: '勝' },
  lost: { label: 'Lost', chip: 'chip chip-red', kanji: '敗' },
  draw: { label: 'Draw', chip: 'chip chip-muted', kanji: '分' },
  cancelled: { label: 'Called off', chip: 'chip chip-muted', kanji: '止' },
};
