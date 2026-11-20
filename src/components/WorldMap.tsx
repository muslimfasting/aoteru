'use client';

/**
 * The illustrated province map.
 *
 * Geometry comes from src/game/map.ts; ownership, garrisons, battles and
 * marching armies come from the server. Supports mouse drag + wheel, touch
 * drag + pinch, keyboard selection and on-screen zoom buttons.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ClanPublicDTO, MovementDTO, ProvinceSummaryDTO } from '@/game/api';
import { bannerHex, totalUnits, type Terrain } from '@/game/config';
import { MAP_DECOR, MAP_SIZE, PROVINCE_BY_CODE, PROVINCES, type Point } from '@/game/map';
import { createRng } from '@/game/rng';
import { useNow } from '@/lib/clock';
import { cx, fmt } from '@/lib/format';
import { MonGlyph } from './Banner';

import { Icon } from './icons';
const INK = '#17130e';
const PAPER = '#e6d9ba';
const CREAM = '#f6ecd3';
const SEA = '#1d2c33';
const MIN_ZOOM = 1;
const MAX_ZOOM = 4.5;

interface View {
  k: number;
  x: number;
  y: number;
}

const HOME: View = { k: 1, x: 0, y: 0 };

/** Bounding box of the playable provinces, used to frame the opening view. */
const BOUNDS = (() => {
  const xs = PROVINCES.flatMap((p) => p.polygon.map((q) => q[0]));
  const ys = PROVINCES.flatMap((p) => p.polygon.map((q) => q[1]));
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
})();

/** Zoom so the provinces fill a container of the given pixel size. */
function fitView(width: number, height: number): View {
  if (width <= 0 || height <= 0) return HOME;
  const base = Math.min(width / MAP_SIZE.width, height / MAP_SIZE.height);
  const pad = 46;
  const wanted = Math.min(width / (BOUNDS.w + pad * 2), height / (BOUNDS.h + pad * 2));
  const k = Math.max(1, Math.min(2.2, wanted / base));
  return { k, x: MAP_SIZE.width / 2 - BOUNDS.cx * k, y: MAP_SIZE.height / 2 - BOUNDS.cy * k };
}

/** Scenery labels nudged clear of other features. */
const LABEL_NUDGE: Record<string, [number, number]> = { 'Osaka Bay': [34, -34] };

interface Extent {
  /** Visible width and height in map units (larger than the map when letterboxed). */
  w: number;
  h: number;
}

const DEFAULT_EXTENT: Extent = { w: MAP_SIZE.width, h: MAP_SIZE.height };

/** Keep a good part of the map inside the visible window, whatever its shape. */
function clampView(v: View, extent: Extent = DEFAULT_EXTENT): View {
  const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.k));
  const keep = 220;
  const left = MAP_SIZE.width / 2 - extent.w / 2;
  const right = MAP_SIZE.width / 2 + extent.w / 2;
  const top = MAP_SIZE.height / 2 - extent.h / 2;
  const bottom = MAP_SIZE.height / 2 + extent.h / 2;
  return {
    k,
    x: Math.max(left + keep - MAP_SIZE.width * k, Math.min(right - keep, v.x)),
    y: Math.max(top + keep - MAP_SIZE.height * k, Math.min(bottom - keep, v.y)),
  };
}

function pointsAttr(poly: readonly Point[]): string {
  return poly.map((p) => `${p[0]},${p[1]}`).join(' ');
}

// --- small geometry helpers for the terrain ornaments ----------------------

function inside(poly: readonly Point[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function edgeDistance(poly: readonly Point[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, y1] = poly[j];
    const [x2, y2] = poly[i];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)));
  }
  return best;
}

interface Ornament {
  x: number;
  y: number;
  s: number;
  terrain: Terrain;
}

/** Deterministic scatter of little terrain marks inside each province. */
const ORNAMENTS: Record<string, Ornament[]> = (() => {
  const out: Record<string, Ornament[]> = {};
  for (const p of PROVINCES) {
    const rng = createRng(`ornament:${p.code}`);
    const xs = p.polygon.map((q) => q[0]);
    const ys = p.polygon.map((q) => q[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const marks: Ornament[] = [];
    const want = p.terrain === 'mountains' ? 9 : p.terrain === 'hills' ? 7 : 5;
    for (let tries = 0; tries < 400 && marks.length < want; tries++) {
      const x = rng.range(minX, maxX);
      const y = rng.range(minY, maxY);
      if (!inside(p.polygon, x, y)) continue;
      if (edgeDistance(p.polygon, x, y) < 20) continue;
      if (Math.abs(x - p.label[0]) < 62 && y > p.label[1] - 66 && y < p.label[1] + 50) continue;
      if (p.code === 'omi' && inside(MAP_DECOR.lakeBiwa, x, y)) continue;
      if (p.code === 'omi' && edgeDistance(MAP_DECOR.lakeBiwa, x, y) < 16) continue;
      if (marks.some((m) => Math.hypot(m.x - x, m.y - y) < 34)) continue;
      marks.push({ x: Math.round(x), y: Math.round(y), s: rng.range(0.85, 1.25), terrain: p.terrain });
    }
    out[p.code] = marks;
  }
  return out;
})();

function OrnamentGlyph({ o }: { o: Ornament }) {
  const t = `translate(${o.x} ${o.y}) scale(${o.s.toFixed(2)})`;
  switch (o.terrain) {
    case 'mountains':
      return (
        <g transform={t} fill="none" stroke={INK} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.42">
          <path d="M-13,7 L-4,-8 L1,0 L5,-5 L13,7" />
          <path d="M-4,-8 L-2,-2 L-5,1" strokeWidth="1" />
        </g>
      );
    case 'hills':
      return (
        <g transform={t} fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round" opacity="0.4">
          <path d="M-12,5 Q-5,-8 2,5 M0,5 Q6,-4 12,5" />
        </g>
      );
    case 'coast':
      return (
        <g transform={t} fill="none" stroke={INK} strokeWidth="1.3" strokeLinecap="round" opacity="0.36">
          <path d="M0,7 V-2 M0,-8 L-5,-1 H5 Z M0,-4 L-6,3 H6 Z" strokeLinejoin="round" />
        </g>
      );
    default:
      return (
        <g transform={t} fill="none" stroke={INK} strokeWidth="1.2" strokeLinecap="round" opacity="0.32">
          <path d="M-9,-4 H9 M-9,1 H9 M-9,6 H9 M-4,-4 V6 M3,-4 V6" />
        </g>
      );
  }
}

function CastleIcon({ fill = INK }: { fill?: string }) {
  return (
    <g fill={fill} stroke={CREAM} strokeWidth="0.9" strokeLinejoin="round" paintOrder="stroke">
      <path d="M-8,9 L-6.5,3 H6.5 L8,9 Z" />
      <path d="M-10,3 Q-6.5,1.2 -5.5,-1.5 H5.5 Q6.5,1.2 10,3 Z" />
      <path d="M-4.2,-1.5 V-4.5 H4.2 V-1.5 Z" />
      <path d="M-7.5,-4.5 Q-4.2,-6.2 -3.2,-9 H3.2 Q4.2,-6.2 7.5,-4.5 Z" />
      <path d="M0,-9 V-12" stroke={fill} strokeWidth="1.4" />
    </g>
  );
}

function along(points: Point[], t: number): { x: number; y: number; angle: number } {
  if (points.length === 1) return { x: points[0][0], y: points[0][1], angle: 0 };
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    lengths.push(len);
    total += len;
  }
  let dist = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < lengths.length; i++) {
    if (dist <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] > 0 ? Math.min(1, dist / lengths[i]) : 0;
      const [x1, y1] = points[i];
      const [x2, y2] = points[i + 1];
      return { x: x1 + (x2 - x1) * f, y: y1 + (y2 - y1) * f, angle: Math.atan2(y2 - y1, x2 - x1) };
    }
    dist -= lengths[i];
  }
  const last = points[points.length - 1];
  return { x: last[0], y: last[1], angle: 0 };
}

export interface WorldMapProps {
  provinces: ProvinceSummaryDTO[];
  clans: ClanPublicDTO[];
  movements?: MovementDTO[];
  selectedId?: string | null;
  onSelect?: (provinceId: string | null) => void;
  /** `found`: only start slots can be chosen and they are called out. */
  mode?: 'game' | 'found';
  className?: string;
  /** Hide zoom buttons and legend (used for small embedded maps). */
  bare?: boolean;
  /**
   * Bring the selected province into view at this fraction of the map's height
   * (0 = top, 1 = bottom). Used on phones, where a sheet covers the lower part.
   */
  focusY?: number;
}

export function WorldMap({ provinces, clans, movements = [], selectedId, onSelect, mode = 'game', className, bare, focusY }: WorldMapProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(HOME);
  const home = useRef<View>(HOME);
  const extent = useRef<Extent>(DEFAULT_EXTENT);
  const userMoved = useRef(false);

  // Frame the provinces to the container, and re-frame on resize until the player moves the map.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => {
      const scale = Math.min(el.clientWidth / MAP_SIZE.width, el.clientHeight / MAP_SIZE.height);
      if (scale > 0) extent.current = { w: el.clientWidth / scale, h: el.clientHeight / scale };
      home.current = fitView(el.clientWidth, el.clientHeight);
      if (!userMoved.current) setView(home.current);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [hovered, setHovered] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const now = useNow();

  const clanById = useMemo(() => new Map(clans.map((c) => [c.id, c])), [clans]);
  const provinceById = useMemo(() => new Map(provinces.map((p) => [p.id, p])), [provinces]);
  const byCode = useMemo(() => new Map(provinces.map((p) => [p.code, p])), [provinces]);

  // --- pan & zoom -----------------------------------------------------------

  const toSvg = useCallback((clientX: number, clientY: number): { x: number; y: number; unitsPerPx: number } => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm || ctm.a === 0) return { x: 0, y: 0, unitsPerPx: 1 };
    return { x: (clientX - ctm.e) / ctm.a, y: (clientY - ctm.f) / ctm.d, unitsPerPx: 1 / ctm.a };
  }, []);

  const zoomAt = useCallback((px: number, py: number, factor: number) => {
    userMoved.current = true;
    setView((v) => {
      const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.k * factor));
      const ratio = k / v.k;
      return clampView({ k, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio }, extent.current);
    });
  }, []);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef({ moved: 0, pinchDist: 0, tapTarget: null as string | null, active: false });

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      drag.current.moved = 0;
      drag.current.active = true;
      const el = (e.target as Element).closest?.('[data-province]');
      drag.current.tapTarget = el?.getAttribute('data-province') ?? null;
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      drag.current.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      drag.current.moved = 99;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable */
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, next);
    const { unitsPerPx } = toSvg(0, 0);

    if (pointers.current.size === 1) {
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      drag.current.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.current.moved > 6) {
        userMoved.current = true;
        setView((v) => clampView({ k: v.k, x: v.x + dx * unitsPerPx, y: v.y + dy * unitsPerPx }, extent.current));
      }
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = toSvg((a.x + b.x) / 2, (a.y + b.y) / 2);
      if (drag.current.pinchDist > 0 && dist > 0) zoomAt(mid.x, mid.y, dist / drag.current.pinchDist);
      drag.current.pinchDist = dist;
    }
  };

  const endPointer = (e: React.PointerEvent<SVGSVGElement>, cancelled: boolean) => {
    const had = pointers.current.has(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (!had) return;
    if (pointers.current.size === 0 && drag.current.active) {
      drag.current.active = false;
      if (!cancelled && drag.current.moved <= 6) {
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-province]');
        const id = el?.getAttribute('data-province') ?? drag.current.tapTarget;
        if (id) select(id);
        else onSelect?.(null);
      }
    }
    if (pointers.current.size < 2) drag.current.pinchDist = 0;
  };

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toSvg(e.clientX, e.clientY);
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0016));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [toSvg, zoomAt]);

  // Slide the selected province into the part of the map that stays visible.
  const selectedCode = selectedId ? provinceById.get(selectedId)?.code : undefined;
  useEffect(() => {
    if (focusY === undefined || !selectedCode) return;
    const label = PROVINCE_BY_CODE[selectedCode]?.label;
    const el = wrapRef.current;
    const ctm = svgRef.current?.getScreenCTM();
    if (!label || !el || !ctm || ctm.a === 0) return;
    userMoved.current = true;
    setView((v) => {
      const k = Math.max(v.k, 1.25);
      const targetY = MAP_SIZE.height / 2 + ((focusY - 0.5) * el.clientHeight) / ctm.a;
      return clampView({ k, x: MAP_SIZE.width / 2 - label[0] * k, y: targetY - label[1] * k }, extent.current);
    });
  }, [selectedCode, focusY]);

  const select = (id: string) => {
    const p = provinceById.get(id);
    if (!p) return;
    if (mode === 'found' && !p.isStartSlot) return;
    onSelect?.(id);
  };

  const zoomButton = (factor: number) => zoomAt(MAP_SIZE.width / 2, MAP_SIZE.height / 2, factor);

  // --- render ---------------------------------------------------------------

  const ordered = useMemo(() => {
    // Draw the selected and hovered provinces last so their outlines sit on top.
    const list = PROVINCES.map((def) => ({ def, p: byCode.get(def.code) })).filter((e): e is { def: (typeof PROVINCES)[number]; p: ProvinceSummaryDTO } => Boolean(e.p));
    return list.sort((a, b) => Number(a.p.id === selectedId) - Number(b.p.id === selectedId));
  }, [byCode, selectedId]);

  return (
    <div ref={wrapRef} className={cx('relative h-full w-full overflow-hidden', className)} style={{ background: SEA }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${MAP_SIZE.width} ${MAP_SIZE.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endPointer(e, false)}
        onPointerCancel={(e) => endPointer(e, true)}
        role="group"
        aria-label="Map of the Kansai provinces"
      >
        <defs>
          <pattern id={`${uid}-sea`} width="44" height="22" patternUnits="userSpaceOnUse">
            <rect width="44" height="22" fill={SEA} />
            {[
              [22, 0],
              [0, 11],
              [44, 11],
              [22, 22],
              [0, 33],
              [44, 33],
            ].map(([cx0, cy0], i) => (
              <g key={i} fill={SEA} stroke="#6f8f96" strokeOpacity="0.2" strokeWidth="1">
                <circle cx={cx0} cy={cy0} r="21" />
                <circle cx={cx0} cy={cy0} r="15" fill="none" />
                <circle cx={cx0} cy={cy0} r="9" fill="none" />
                <circle cx={cx0} cy={cy0} r="3.5" fill="none" />
              </g>
            ))}
          </pattern>
          <pattern id={`${uid}-hatch`} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
            <line x1="0" y1="0" x2="0" y2="9" stroke="#3a2f1c" strokeOpacity="0.2" strokeWidth="2.2" />
          </pattern>
          <radialGradient id={`${uid}-vignette`} cx="0.5" cy="0.5" r="0.75">
            <stop offset="0.55" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.55" />
          </radialGradient>
          <linearGradient id={`${uid}-wash`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff8e4" stopOpacity="0.35" />
            <stop offset="1" stopColor="#7a6034" stopOpacity="0.28" />
          </linearGradient>
        </defs>

        <g transform={`translate(${view.x.toFixed(2)} ${view.y.toFixed(2)}) scale(${view.k.toFixed(4)})`}>
          {/* sea */}
          <rect x="-2500" y="-2500" width="6000" height="6000" fill={`url(#${uid}-sea)`} />

          {/* lands beyond the prototype region; the mainland continues past the sheet to the west, north and east */}
          <polygon points={pointsAttr(MAP_DECOR.land)} fill="#a39678" stroke={INK} strokeWidth="5" strokeLinejoin="round" />
          <path d="M-2500,-2500 H3500 V300 H1000 V0 H0 V430 H-2500 Z" fill="#a39678" />
          <path d="M0,0 H1000 M0,-4 V430 M1000,-4 V300" stroke="#a39678" strokeWidth="8" />
          <path d="M-2500,430 H0 M1000,300 H3500" stroke={INK} strokeWidth="5" strokeLinecap="round" />
          <polygon points={pointsAttr(MAP_DECOR.land)} fill={`url(#${uid}-hatch)`} opacity="0.7" />
          <path d="M-2500,-2500 H3500 V300 H1000 V0 H0 V430 H-2500 Z" fill={`url(#${uid}-hatch)`} opacity="0.7" />
          <polygon points={pointsAttr(MAP_DECOR.awaji)} fill="#a39678" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />

          {/* provinces */}
          {ordered.map(({ def, p }) => {
            const owner = p.ownerClanId ? clanById.get(p.ownerClanId) : undefined;
            const isSelected = p.id === selectedId;
            const isHover = hovered === p.id;
            const selectable = mode === 'game' || p.isStartSlot;
            const dim = mode === 'found' && !p.isStartSlot;
            const total = p.garrison ? totalUnits(p.garrison) : null;
            return (
              <g
                key={p.id}
                data-province={p.id}
                role="button"
                tabIndex={selectable ? 0 : -1}
                aria-label={`${p.name}${owner ? `, held by ${owner.name}` : ', unclaimed'}${p.underAttack ? ', under attack' : ''}`}
                aria-pressed={isSelected}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    select(p.id);
                  }
                }}
                onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(p.id)}
                onPointerLeave={() => setHovered((h) => (h === p.id ? null : h))}
                className={cx('outline-none', selectable ? 'cursor-pointer' : 'cursor-not-allowed')}
                opacity={dim ? 0.55 : 1}
              >
                <polygon points={pointsAttr(def.polygon)} fill={PAPER} />
                <polygon points={pointsAttr(def.polygon)} fill={`url(#${uid}-wash)`} />
                {owner ? (
                  <polygon points={pointsAttr(def.polygon)} fill={bannerHex(owner.banner.color)} fillOpacity={p.relation === 'own' ? 0.74 : 0.6} />
                ) : (
                  <polygon points={pointsAttr(def.polygon)} fill={`url(#${uid}-hatch)`} />
                )}
                {isHover && selectable ? <polygon points={pointsAttr(def.polygon)} fill="#fff6dc" fillOpacity="0.16" /> : null}
                {ORNAMENTS[def.code].map((o, i) => (
                  <OrnamentGlyph key={i} o={o} />
                ))}
                <polygon points={pointsAttr(def.polygon)} fill="none" stroke={INK} strokeWidth="3.4" strokeLinejoin="round" />
                {p.relation === 'own' ? (
                  <polygon points={pointsAttr(def.polygon)} fill="none" stroke="#f0d68c" strokeWidth="1.6" strokeLinejoin="round" opacity="0.9" />
                ) : null}
                {p.relation === 'enemy' ? (
                  <polygon points={pointsAttr(def.polygon)} fill="none" stroke="#d9514f" strokeWidth="2.6" strokeLinejoin="round" strokeDasharray="10 7" />
                ) : null}
                {p.relation === 'allied' ? (
                  <polygon points={pointsAttr(def.polygon)} fill="none" stroke="#7fc79b" strokeWidth="2.4" strokeLinejoin="round" strokeDasharray="2 6" strokeLinecap="round" />
                ) : null}
                {isSelected ? (
                  <>
                    <polygon points={pointsAttr(def.polygon)} fill="none" stroke="#fff3c9" strokeWidth="7" strokeLinejoin="round" opacity="0.35" />
                    <polygon points={pointsAttr(def.polygon)} fill="none" stroke="#e9c765" strokeWidth="3.6" strokeLinejoin="round" />
                  </>
                ) : null}
                {/* focus ring for keyboard users */}
                <polygon points={pointsAttr(def.polygon)} fill="none" strokeWidth="4" strokeLinejoin="round" className="stroke-transparent [g:focus-visible>&]:stroke-white" />
                {/* enlarged hit area is the polygon itself */}
                {total !== null ? <title>{`${p.name}: ${fmt(total)} soldiers`}</title> : <title>{p.name}</title>}
              </g>
            );
          })}

          {/* Lake Biwa sits on top of Omi */}
          <polygon points={pointsAttr(MAP_DECOR.lakeBiwa)} fill={`url(#${uid}-sea)`} stroke={INK} strokeWidth="2.6" strokeLinejoin="round" pointerEvents="none" />

          {/* scenery labels */}
          <g pointerEvents="none" fontFamily="var(--font-display)" textAnchor="middle">
            {MAP_DECOR.labels.map((l) => (
              <text
                key={l.text}
                x={l.at[0] + (LABEL_NUDGE[l.text]?.[0] ?? 0)}
                y={l.at[1] + (LABEL_NUDGE[l.text]?.[1] ?? 0)}
                fontSize={l.kind === 'lake' ? 11 : l.kind === 'sea' ? 17 : 15}
                fontStyle="italic"
                letterSpacing={l.kind === 'land' ? 4 : 2.5}
                fill={l.kind === 'land' ? '#2e2616' : '#9fbcc2'}
                opacity={l.kind === 'land' ? 0.55 : 0.75}
              >
                {l.kind === 'land' ? l.text.toUpperCase() : l.text}
              </text>
            ))}
          </g>

          {/* marching armies */}
          <g pointerEvents="none">
            {movements.map((m) => {
              const from = provinceById.get(m.fromProvinceId);
              const clan = clanById.get(m.clanId);
              if (!from) return null;
              const pts: Point[] = [PROVINCE_BY_CODE[from.code]?.label].filter(Boolean) as Point[];
              const pathIds = m.path.length ? m.path : [m.toProvinceId];
              for (const pid of pathIds) {
                const pr = provinceById.get(pid);
                const lbl = pr ? PROVINCE_BY_CODE[pr.code]?.label : undefined;
                if (lbl) pts.push(lbl);
              }
              if (pts.length < 2) return null;
              // Keep the route clear of the province labels at both ends.
              const trim = (a: Point, b: Point, by: number): Point => {
                const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
                if (len < by * 2.4) return a;
                return [a[0] + ((b[0] - a[0]) * by) / len, a[1] + ((b[1] - a[1]) * by) / len];
              };
              pts[0] = trim(pts[0], pts[1], 52);
              pts[pts.length - 1] = trim(pts[pts.length - 1], pts[pts.length - 2], 52);
              const start = Date.parse(m.departedAt);
              const end = Date.parse(m.arrivesAt);
              const raw = now === 0 || end <= start ? 0 : (now - start) / (end - start);
              const t = m.status === 'besieging' ? 0.76 : Math.max(0, Math.min(0.9, raw * 0.9));
              const pos = along(pts, t);
              const color = clan ? bannerHex(clan.banner.color) : '#777';
              const lineColor = m.intent === 'attack' ? '#e2605c' : m.intent === 'return' ? '#b8ad95' : '#f0d68c';
              return (
                <g key={m.id}>
                  <polyline points={pointsAttr(pts)} fill="none" stroke={INK} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
                  <polyline points={pointsAttr(pts)} fill="none" stroke={lineColor} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 9" />
                  <g style={{ transform: `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px) scale(1.45)`, transition: 'transform 1s linear' }}>
                    <ellipse rx="13" ry="5" fill={INK} opacity="0.4" cy="14" />
                    <path d="M-7,14 V-18" stroke={INK} strokeWidth="3.4" strokeLinecap="round" />
                    <path d="M-6,-17 H13 V2 H-6 Z" fill={color} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
                    {clan ? (
                      <g transform="translate(3.5 -7.5) scale(0.72)" fill={CREAM} color={CREAM}>
                        <MonGlyph mon={clan.banner.mon} />
                      </g>
                    ) : null}
                    {m.own && m.total !== null ? (
                      <text x="4" y="27" textAnchor="middle" fontSize="12" fontWeight="700" fill={CREAM} stroke={INK} strokeWidth="3.4" paintOrder="stroke" fontFamily="var(--font-body)">
                        {fmt(m.total)}
                      </text>
                    ) : null}
                  </g>
                </g>
              );
            })}
          </g>

          {/* province labels and markers */}
          <g pointerEvents="none" textAnchor="middle">
            {ordered.map(({ def, p }) => {
              const owner = p.ownerClanId ? clanById.get(p.ownerClanId) : undefined;
              const [x, y] = def.label;
              const total = p.garrison ? totalUnits(p.garrison) : null;
              const dim = mode === 'found' && !p.isStartSlot;
              return (
                <g key={p.id} opacity={dim ? 0.5 : 1}>
                  {/* crest / castle row */}
                  {owner ? (
                    <g transform={`translate(${p.isCapital ? x - 13 : x} ${y - 46})`}>
                      <circle r="12.5" fill={bannerHex(owner.banner.color)} stroke={INK} strokeWidth="2" />
                      <g fill={CREAM} color={CREAM} transform="scale(0.92)">
                        <MonGlyph mon={owner.banner.mon} />
                      </g>
                    </g>
                  ) : null}
                  {p.isCapital ? (
                    <g transform={`translate(${owner ? x + 15 : x} ${y - 45}) scale(1.25)`}>
                      <CastleIcon />
                    </g>
                  ) : null}
                  {!owner && p.isStartSlot ? (
                    <g transform={`translate(${x} ${y - 46})`}>
                      {mode === 'found' ? <circle r="14" fill="none" stroke="#e9c765" strokeWidth="2" className="origin-center animate-pulse-ring [transform-box:fill-box]" /> : null}
                      <circle r="12.5" fill={CREAM} stroke={INK} strokeWidth="2" strokeDasharray="4 3" />
                      <path d="M-5.5,0 H5.5 M0,-5.5 V5.5" stroke="#9b2d30" strokeWidth="2.6" strokeLinecap="round" />
                    </g>
                  ) : null}

                  <text x={x} y={y + 9} fontFamily="var(--font-display)" fontSize="21" fontWeight="700" fill={INK} stroke={CREAM} strokeOpacity="0.85" strokeWidth="5" paintOrder="stroke" strokeLinejoin="round" letterSpacing="1.5">
                    {def.name.toUpperCase()}
                  </text>

                  {total !== null ? (
                    <g transform={`translate(${x} ${y + 38})`}>
                      <rect x="-29" y="-11" width="58" height="20" rx="3" fill={INK} stroke="#e9c765" strokeWidth="1.1" />
                      <g style={{ color: '#e9c765' }}>
                        <Icon name="army" size={13} x={-25} y={-8} strokeWidth={2.2} />
                      </g>
                      <text x="7" y="4" fontFamily="var(--font-body)" fontSize="12" fontWeight="700" fill={CREAM}>
                        {fmt(total)}
                      </text>
                    </g>
                  ) : null}

                  {p.underAttack ? (
                    <g transform={`translate(${x + 44} ${y - 34})`}>
                      <circle r="15" fill="none" stroke="#e2605c" strokeWidth="3" className="origin-center animate-pulse-ring [transform-box:fill-box]" />
                      <circle r="14" fill="#9b2d30" stroke={INK} strokeWidth="2" />
                      <g style={{ color: CREAM }}>
                        <Icon name="military" size={17} x={-8.5} y={-8.5} strokeWidth={2.2} />
                      </g>
                    </g>
                  ) : null}
                </g>
              );
            })}
          </g>

          {/* cartouche */}
          <g pointerEvents="none" transform="translate(905 800)">
            <rect x="-62" y="-70" width="124" height="140" fill={PAPER} stroke={INK} strokeWidth="3" />
            <rect x="-56" y="-64" width="112" height="128" fill="none" stroke={INK} strokeWidth="1" />
            <g style={{ color: INK }}>
              <Icon name="castle" size={46} x={-23} y={-64} strokeWidth={1.4} />
            </g>
            <text y="12" textAnchor="middle" fontFamily="var(--font-display)" fontSize="15" fontWeight="700" letterSpacing="5" fill={INK}>
              KANSAI
            </text>
            <text y="32" textAnchor="middle" fontFamily="var(--font-display)" fontSize="9.5" fontStyle="italic" fill="#4a3c22">
              the home provinces
            </text>
            <rect x="-13" y="40" width="26" height="18" fill="#9b2d30" />
            <g style={{ color: CREAM }}>
              <Icon name="map" size={14} x={-7} y={42} strokeWidth={2} />
            </g>
          </g>

          {/* compass */}
          <g pointerEvents="none" transform="translate(72 705)" opacity="0.8">
            <circle r="26" fill="none" stroke="#9fbcc2" strokeOpacity="0.5" strokeWidth="1.2" />
            <path d="M0,-34 L6,0 L0,34 L-6,0 Z" fill="#9fbcc2" fillOpacity="0.55" />
            <path d="M-34,0 L0,-5 L34,0 L0,5 Z" fill="#9fbcc2" fillOpacity="0.3" />
            <text y="-39" textAnchor="middle" fontFamily="var(--font-display)" fontSize="14" fontWeight="700" fill="#cfe3e6">
              N
            </text>
          </g>
        </g>

        {/* fixed vignette */}
        <rect x="-2500" y="-2500" width="6000" height="6000" fill={`url(#${uid}-vignette)`} pointerEvents="none" opacity="0.5" />
      </svg>

      {/* inner frame */}
      <div className="pointer-events-none absolute inset-0 border border-gold/25 shadow-[inset_0_0_60px_rgba(0,0,0,0.45)]" />

      {!bare ? (
        <>
          <div className="absolute right-3 top-3 flex flex-col gap-1.5">
            <button type="button" className="btn btn-ink !min-h-[44px] !w-[44px] !px-0 text-xl shadow-lg" onClick={() => zoomButton(1.4)} aria-label="Zoom in" disabled={view.k >= MAX_ZOOM}>
              +
            </button>
            <button type="button" className="btn btn-ink !min-h-[44px] !w-[44px] !px-0 text-xl shadow-lg" onClick={() => zoomButton(1 / 1.4)} aria-label="Zoom out" disabled={view.k <= MIN_ZOOM + 0.001}>
              −
            </button>
            <button
              type="button"
              className="btn btn-ink !min-h-[44px] !w-[44px] !px-0 font-display text-base shadow-lg"
              onClick={() => {
                userMoved.current = false;
                setView(home.current);
              }}
              aria-label="Reset the map view"
            >
              <Icon name="expand" />
            </button>
          </div>

          <div className="absolute bottom-3 left-3 max-w-[15rem]">
            {legendOpen ? (
              <div className="paper mb-1.5 animate-rise space-y-1.5 p-3 text-[0.78rem] leading-snug">
                <LegendRow swatch={<span className="block h-3.5 w-5 border-2 border-[#c9a544] bg-[#9b2d30]/60" />} label="Your land (gold border)" />
                <LegendRow swatch={<span className="block h-3.5 w-5 border-2 border-dashed border-[#c94a48] bg-[#31487a]/60" />} label="At war with you" />
                <LegendRow swatch={<span className="block h-3.5 w-5 border-2 border-dotted border-[#5fae80] bg-[#31487a]/60" />} label="Your ally (garrison shown)" />
                <LegendRow swatch={<span className="block h-3.5 w-5 border-2 border-ink-900 bg-[#31487a]/60" />} label="Another nation" />
                <LegendRow
                  swatch={<span className="block h-3.5 w-5 border-2 border-ink-900" style={{ background: 'repeating-linear-gradient(128deg,#e6d9ba 0 3px,#c9bb98 3px 5px)' }} />}
                  label="Unclaimed, held by local militia"
                />
                <LegendRow swatch={<span className="font-display text-sm font-bold text-vermilion">+</span>} label="Open for a new nation" />
                <LegendRow swatch={<span className="text-vermilion"><Icon name="military" /></span>} label="Battle in progress" />
                <LegendRow swatch={<Icon name="army" />} label="Your garrison" />
              </div>
            ) : null}
            <button type="button" className="btn btn-ink btn-sm !min-h-[44px] shadow-lg" onClick={() => setLegendOpen((o) => !o)} aria-expanded={legendOpen}>
              <Icon name="map" /> Legend
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function LegendRow({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid w-6 place-items-center">{swatch}</span>
      <span>{label}</span>
    </div>
  );
}
