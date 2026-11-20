import { RESOURCE_KEYS, UNIT_TYPES, UNITS, type ResourceBag, type ResourceKey, type UnitCounts } from '@/game/config';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat('en');

export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return plain.format(Math.round(n));
}

/** 12,340 → 12.3K. Keeps small numbers exact. */
export function fmtCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (Math.abs(n) < 10000) return plain.format(Math.round(n));
  return compact.format(n);
}

export function fmtSigned(n: number): string {
  const r = Math.round(n);
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${plain.format(Math.abs(r))}`;
}

export function fmtPct(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** Real-time duration, e.g. 1h 05m, 4m 09s, 12s. */
export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/** Countdown clock, e.g. 1:05:09 or 4:09. */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function timeAgo(iso: string, nowMs: number): string {
  const diff = nowMs - Date.parse(iso);
  if (!Number.isFinite(diff)) return '';
  if (diff < 45_000) return 'just now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Traditional double-hour names give the game clock a period voice. */
const HOUR_NAMES = ['Rat', 'Ox', 'Tiger', 'Rabbit', 'Dragon', 'Snake', 'Horse', 'Goat', 'Monkey', 'Rooster', 'Dog', 'Boar'];
export function hourName(hour: number): string {
  return HOUR_NAMES[Math.floor((((hour + 1) % 24) + 24) % 24 / 2)];
}

export function missingResources(have: ResourceBag | null | undefined, cost: Partial<ResourceBag> | null | undefined): ResourceKey[] {
  if (!cost) return [];
  if (!have) return [];
  return RESOURCE_KEYS.filter((k) => (cost[k] ?? 0) > have[k]);
}

export function unitsSummary(units: Partial<UnitCounts> | null | undefined): string {
  if (!units) return '';
  const parts = UNIT_TYPES.filter((t) => (units[t] ?? 0) > 0).map((t) => `${fmt(units[t]!)} ${UNITS[t].name}`);
  return parts.length ? parts.join(', ') : 'No soldiers';
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
