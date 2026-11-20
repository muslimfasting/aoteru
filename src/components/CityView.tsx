/**
 * The chief town of a province, drawn from above like a hand-coloured survey map.
 *
 * Purely presentational: every element is derived from the building levels the
 * server reports, so the town visibly grows as the player builds — more tiers
 * on the keep, more paddies along the river, a longer market street, new houses
 * filling the blocks — and picks up the trappings of a land rebuilding itself
 * at a Meiji-era level: brick trading houses, street lamps, a telegraph line,
 * a factory chimney.
 *
 * North is up and the light comes from the north-west, so every roof has a lit
 * and a shaded side and every shadow falls to the south-east.
 */
import { memo, type ReactNode } from 'react';
import { BUILDINGS, type BuildingLevels, type BuildingType, type Terrain } from '@/game/config';
import { createRng, type Rng } from '@/game/rng';
import { Icon } from './icons';

const W = 960;
const H = 440;

const INK = '#221c15';
const PAPER = '#efe3c6';
const RED = '#9b2d30';
const GOLD = '#c8a24a';
const SHADOW = '#1a140e';
const LAND = '#cdc996';
const LAND_L = '#dedaae';
const LAND_D = '#afb17c';
const EARTH = '#e0cf9e';
const EARTH_D = '#c5af79';
const BANK = '#a48d5a';
const ROAD = '#f0e3bd';
const ROAD_EDGE = '#9c8759';
const WATER = '#86adab';
const WATER_L = '#afcec6';
const WATER_D = '#557f83';
const SEA = '#6f9aa2';
const PADDY = '#a9c49b';
const RICE = '#5f7f48';
const PINE = '#3d5b44';
const PINE_L = '#5a7d58';
const LEAF = '#62834e';
const LEAF_L = '#8aa66a';
const BLOSSOM = '#dfa9a5';
const BLOSSOM_L = '#f3d3cc';
const STONE = '#a69d86';
const STONE_D = '#7f7762';
const PLASTER = '#f6efdd';
const WOOD = '#8a6a48';
const WOOD_D = '#654b32';
const LIGHT = '#f8d77f';
const AMBER = '#e0a630';

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const pts = (list: number[][]) => list.map((p) => p.join(',')).join(' ');

export interface CityViewProps {
  name: string;
  terrain: Terrain;
  levels: BuildingLevels;
  /** Building currently under construction, if any. */
  upgrading: BuildingType | null;
  /** Clan colour (hex) for the banners. */
  bannerHex: string;
  /** Game hour 0-23: the map shifts between day, dusk and night. */
  hour: number;
  className?: string;
}

/** What the next levels will add to the map, so it doubles as a goal list. */
const LANDMARKS: { type: BuildingType; level: number; text: string }[] = [
  { type: 'barracks', level: 1, text: 'a drill yard behind a palisade' },
  { type: 'market', level: 1, text: 'the first shops along the highway' },
  { type: 'castle', level: 2, text: 'a second roof on the keep and your flags' },
  { type: 'barracks', level: 2, text: 'a rifle range' },
  { type: 'dojo', level: 1, text: 'the academy hall and its gate' },
  { type: 'farm', level: 3, text: 'a white-walled storehouse' },
  { type: 'castle', level: 3, text: 'plastered walls and a gatehouse' },
  { type: 'market', level: 3, text: 'a brick trading house' },
  { type: 'dojo', level: 2, text: 'stables and a paddock' },
  { type: 'barracks', level: 4, text: 'a brick armoury' },
  { type: 'castle', level: 4, text: 'a fourth roof on the keep' },
  { type: 'dojo', level: 4, text: 'rows of bayonet-drill posts' },
  { type: 'market', level: 5, text: 'a clock tower on the square' },
  { type: 'castle', level: 5, text: 'the full five-roofed keep' },
  { type: 'farm', level: 6, text: 'a water mill' },
  { type: 'castle', level: 6, text: 'corner turrets' },
  { type: 'barracks', level: 6, text: 'a watchtower' },
  { type: 'castle', level: 8, text: 'a water-filled moat' },
];

// --------------------------------------------------------------------- roofs

/** Lit north face, lit west face, shaded east face, shaded south face. */
type Tone = readonly [string, string, string, string];
const ROOFS = {
  tile: ['#6f6a61', '#5c5850', '#403c37', '#322e2a'],
  keep: ['#767c84', '#61666e', '#43464d', '#34373d'],
  keepTop: ['#8d939b', '#777d85', '#565a61', '#45484f'],
  thatch: ['#d8bc76', '#c7a961', '#a58949', '#8e743b'],
  wood: ['#a17f58', '#8d6e49', '#6c5237', '#5a442e'],
  brick: ['#c47860', '#ae6551', '#894b3f', '#763e33'],
} as const satisfies Record<string, Tone>;
type RoofKind = keyof typeof ROOFS;

/**
 * Collects the drawing in layers, so that all shadows lie under all buildings
 * and all tree crowns stand above them, whatever order things are added in.
 */
function createScene() {
  const shadows: ReactNode[] = [];
  const bodies: ReactNode[] = [];
  const canopy: ReactNode[] = [];
  const lights: number[][] = [];
  let n = 0;
  const key = () => `s${n++}`;

  return {
    shadows,
    bodies,
    canopy,
    lights,
    /** Anything flat that belongs with the buildings (flags, rims, targets). */
    add(node: ReactNode) {
      bodies.push(<g key={key()}>{node}</g>);
    },
    /** A window or lantern that glows after dark. */
    light(x: number, y: number, r = 9) {
      lights.push([x, y, r]);
    },
    /** A hipped roof seen from above. `lift` is the height, which sets the shadow. */
    roof(x: number, y: number, w: number, h: number, kind: RoofKind = 'tile', lift = 3, hip = 0.85) {
      const [c0, c1, c2, c3] = ROOFS[kind];
      shadows.push(<rect key={key()} x={x + lift} y={y + lift * 1.25} width={w} height={h} rx={1} />);
      const k = (Math.min(w, h) / 2) * hip;
      if (w >= h) {
        const cy = y + h / 2;
        bodies.push(
          <g key={key()}>
            <polygon points={pts([[x, y], [x + w, y], [x + w - k, cy], [x + k, cy]])} fill={c0} />
            <polygon points={pts([[x, y + h], [x + w, y + h], [x + w - k, cy], [x + k, cy]])} fill={c3} />
            <polygon points={pts([[x, y], [x + k, cy], [x, y + h]])} fill={c1} />
            <polygon points={pts([[x + w, y], [x + w - k, cy], [x + w, y + h]])} fill={c2} />
            <rect x={x} y={y} width={w} height={h} fill="none" stroke={INK} strokeWidth={0.7} />
            <path d={`M${x + k} ${cy}H${x + w - k}`} stroke={INK} strokeWidth={0.8} opacity={0.75} />
          </g>,
        );
      } else {
        const cx = x + w / 2;
        bodies.push(
          <g key={key()}>
            <polygon points={pts([[x, y], [x, y + h], [cx, y + h - k], [cx, y + k]])} fill={c0} />
            <polygon points={pts([[x + w, y], [x + w, y + h], [cx, y + h - k], [cx, y + k]])} fill={c3} />
            <polygon points={pts([[x, y], [cx, y + k], [x + w, y]])} fill={c1} />
            <polygon points={pts([[x, y + h], [cx, y + h - k], [x + w, y + h]])} fill={c2} />
            <rect x={x} y={y} width={w} height={h} fill="none" stroke={INK} strokeWidth={0.7} />
            <path d={`M${cx} ${y + k}V${y + h - k}`} stroke={INK} strokeWidth={0.8} opacity={0.75} />
          </g>,
        );
      }
    },
    /** A square tower roof. `ridge` > 0 gives the top roof a short ridge. */
    pyramid(cx: number, cy: number, s: number, kind: RoofKind = 'keep', ridge = 0) {
      const [c0, c1, c2, c3] = ROOFS[kind];
      const x0 = cx - s / 2;
      const y0 = cy - s / 2;
      const x1 = cx + s / 2;
      const y1 = cy + s / 2;
      const a = [cx - ridge, cy];
      const b = [cx + ridge, cy];
      bodies.push(
        <g key={key()}>
          <polygon points={pts([[x0, y0], [x1, y0], b, a])} fill={c0} />
          <polygon points={pts([[x0, y1], [x1, y1], b, a])} fill={c3} />
          <polygon points={pts([[x0, y0], a, [x0, y1]])} fill={c1} />
          <polygon points={pts([[x1, y0], b, [x1, y1]])} fill={c2} />
          <rect x={x0} y={y0} width={s} height={s} fill="none" stroke={INK} strokeWidth={0.7} />
          <path d={`M${x0} ${y0}L${a}M${x0} ${y1}L${a}M${x1} ${y0}L${b}M${x1} ${y1}L${b}M${a}L${b}`} stroke={INK} strokeWidth={0.55} opacity={0.6} fill="none" />
        </g>,
      );
    },
    /** The long shadow of something tall. */
    sweep(x: number, y: number, w: number, h: number, len: number) {
      const dx = len;
      const dy = len * 1.25;
      shadows.push(<polygon key={key()} points={pts([[x, y + h], [x + w, y], [x + w + dx, y + dy], [x + w + dx, y + h + dy], [x + dx, y + h + dy]])} />);
    },
    tree(x: number, y: number, r: number, kind: 'pine' | 'leaf' | 'blossom' = 'pine') {
      const [base, hi] = kind === 'pine' ? [PINE, PINE_L] : kind === 'leaf' ? [LEAF, LEAF_L] : [BLOSSOM, BLOSSOM_L];
      shadows.push(<ellipse key={key()} cx={x + r * 0.5} cy={y + r * 0.62} rx={r} ry={r * 0.9} />);
      canopy.push(
        <g key={key()}>
          <circle cx={x} cy={y} r={r} fill={base} stroke={INK} strokeWidth={0.5} strokeOpacity={0.5} />
          <circle cx={x - r * 0.26} cy={y - r * 0.3} r={r * 0.56} fill={hi} opacity={0.85} />
        </g>,
      );
    },
  };
}
type Scene = ReturnType<typeof createScene>;

// ------------------------------------------------------------------- terrain

const RIVER = 'M150 -10 C185 60 105 120 128 200 C143 262 170 300 150 350 C138 384 112 410 104 450';
const COAST = 'M852 -10 C830 60 884 118 856 190 C838 240 874 292 860 342 C850 380 882 410 872 450';
const RING = 'M404 102 H556 A24 24 0 0 1 580 126 V270 A24 24 0 0 1 556 294 H404 A24 24 0 0 1 380 270 V126 A24 24 0 0 1 404 102 Z';
const FIELD_TONES = ['#d5c27e', '#bfbd76', '#c9ab6a', '#b3c18b', '#dacf92'];

const PEAK_LIT = [228, 224, 200];
const PEAK_MID = [178, 177, 142];
const PEAK_DARK = [120, 123, 96];
const mix = (a: number[], b: number[], t: number) => `rgb(${a.map((v, i) => Math.round(v + ((b[i] as number) - v) * t)).join(',')})`;

/** A mountain seen from above: facets around a summit, lit from the north-west. */
function peak(rng: Rng, cx: number, cy: number, r: number, k: string): ReactNode {
  const n = rng.int(6, 8);
  const start = rng.range(0, Math.PI * 2);
  const rim: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a = start + (i / n) * Math.PI * 2;
    const rr = r * rng.range(0.78, 1.14);
    rim.push([Math.round((cx + Math.cos(a) * rr) * 10) / 10, Math.round((cy + Math.sin(a) * rr * 0.9) * 10) / 10]);
  }
  const sx = cx - r * 0.06;
  const sy = cy - r * 0.08;
  const facets = rim.map((p, i) => {
    const q = rim[(i + 1) % n] as number[];
    const mx = ((p[0] as number) + (q[0] as number)) / 2 - sx;
    const my = ((p[1] as number) + (q[1] as number)) / 2 - sy;
    const len = Math.hypot(mx, my) || 1;
    const t = ((-(mx / len) - my / len) / Math.SQRT2 + 1) / 2; // 1 faces the light
    const fill = t > 0.5 ? mix(PEAK_MID, PEAK_LIT, (t - 0.5) * 2) : mix(PEAK_DARK, PEAK_MID, t * 2);
    return <polygon key={i} points={pts([[sx, sy], p, q])} fill={fill} stroke={fill} strokeWidth={0.5} strokeLinejoin="round" />;
  });
  return (
    <g key={k}>
      <polygon points={pts(rim.map(([x, y]) => [(x as number) + r * 0.14, (y as number) + r * 0.18]))} fill={SHADOW} opacity={0.16} />
      {facets}
      <path d={rim.map((p) => `M${sx} ${sy}L${p[0]} ${p[1]}`).join('')} stroke={INK} strokeWidth={0.5} opacity={0.32} />
      <polygon points={pts(rim)} fill="none" stroke={INK} strokeWidth={0.6} opacity={0.3} strokeLinejoin="round" />
      {r >= 44 ? (
        <polygon points={pts(rim.map(([x, y]) => [sx + ((x as number) - sx) * 0.3, sy + ((y as number) - sy) * 0.3]))} fill="#f5f1e4" opacity={0.9} strokeLinejoin="round" />
      ) : null}
    </g>
  );
}

function hill(cx: number, cy: number, rx: number, ry: number, k: string): ReactNode {
  return (
    <g key={k}>
      <ellipse cx={cx + rx * 0.1} cy={cy + ry * 0.14} rx={rx} ry={ry} fill={SHADOW} opacity={0.13} />
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#b2b67f" />
      <ellipse cx={cx - rx * 0.08} cy={cy - ry * 0.1} rx={rx * 0.74} ry={ry * 0.74} fill="#bfc28c" stroke={INK} strokeOpacity={0.18} strokeWidth={0.6} />
      <ellipse cx={cx - rx * 0.16} cy={cy - ry * 0.2} rx={rx * 0.47} ry={ry * 0.47} fill="#cdcd9b" stroke={INK} strokeOpacity={0.18} strokeWidth={0.6} />
      <ellipse cx={cx - rx * 0.22} cy={cy - ry * 0.28} rx={rx * 0.2} ry={ry * 0.2} fill="#dbd9ad" stroke={INK} strokeOpacity={0.18} strokeWidth={0.6} />
    </g>
  );
}

/** The countryside around the town: fields, relief, sea and woods. */
function buildTerrain(terrain: Terrain, id: string, seed: string, scene: Scene) {
  const rng = createRng(`${seed}:land`);
  const back: ReactNode[] = [];
  const front: ReactNode[] = [];
  let n = 0;
  const key = () => `t${n++}`;

  const fields = (x0: number, y0: number, x1: number, y1: number, cw: number, ch: number, density: number) => {
    for (let y = y0; y + ch <= y1 + 0.5; y += ch) {
      for (let x = x0; x + cw <= x1 + 0.5; x += cw) {
        const roll = rng.next();
        const tone = FIELD_TONES[rng.int(0, FIELD_TONES.length - 1)];
        const furrow = rng.chance(0.5) ? 'furH' : 'furV';
        if (roll > density) continue;
        back.push(
          <g key={key()}>
            <rect x={x + 1} y={y + 1} width={cw - 2} height={ch - 2} rx={1.5} fill={tone} stroke="#8f8452" strokeWidth={0.6} strokeOpacity={0.7} />
            <rect x={x + 1} y={y + 1} width={cw - 2} height={ch - 2} rx={1.5} fill={`url(#${id}-${furrow})`} />
          </g>,
        );
      }
    }
  };
  const grove = (x0: number, y0: number, x1: number, y1: number, count: number, kind: 'pine' | 'leaf' = 'pine') => {
    for (let i = 0; i < count; i++) scene.tree(rng.range(x0, x1), rng.range(y0, y1), rng.range(4.5, 8), kind);
  };

  // the strip between the river and the town, south of the highway
  fields(198, 370, 378, 430, 36, 30, terrain === 'plains' ? 0.9 : 0.55);

  if (terrain === 'plains') {
    fields(14, 66, 84, 236, 35, 34, 0.9);
    fields(14, 306, 84, 340, 35, 34, 0.9);
    fields(786, 24, 946, 262, 40, 34, 0.85);
    fields(786, 370, 886, 430, 34, 30, 0.8);
    grove(16, 14, 92, 56, 7, 'pine');
    grove(14, 384, 84, 430, 6, 'leaf');
    grove(852, 282, 940, 326, 6, 'leaf');
  } else if (terrain === 'hills') {
    back.push(hill(862, 96, 84, 62, key()), hill(902, 230, 54, 44, key()), hill(54, 86, 44, 52, key()), hill(830, 404, 44, 24, key()));
    fields(14, 180, 84, 236, 35, 28, 0.7);
    fields(14, 306, 84, 340, 35, 34, 0.7);
    fields(786, 170, 846, 262, 30, 31, 0.65);
    grove(820, 60, 900, 130, 9, 'pine');
    grove(876, 204, 930, 256, 6, 'pine');
    grove(26, 50, 82, 120, 6, 'pine');
    grove(14, 384, 84, 430, 6, 'leaf');
    grove(850, 284, 940, 326, 5, 'leaf');
  } else if (terrain === 'mountains') {
    back.push(
      <g key={key()} fill="#b7b78c" opacity={0.6}>
        <ellipse cx={880} cy={80} rx={104} ry={84} />
        <ellipse cx={890} cy={200} rx={80} ry={52} />
        <ellipse cx={46} cy={92} rx={50} ry={84} />
        <ellipse cx={836} cy={404} rx={58} ry={30} />
      </g>,
    );
    const range: [number, number, number][] = [
      [816, 34, 34], [866, 30, 44], [922, 40, 50], [846, 86, 50], [904, 102, 56], [948, 134, 40],
      [836, 196, 36], [886, 204, 48], [938, 190, 38],
      [28, 36, 34], [58, 88, 46], [36, 146, 36],
      [800, 406, 22], [838, 398, 30], [872, 408, 20],
    ];
    for (const [x, y, r] of range.sort((a, b) => a[1] - b[1])) back.push(peak(rng, x, y, r, key()));
    fields(14, 306, 84, 340, 35, 34, 0.6);
    grove(786, 140, 812, 250, 6, 'pine');
    grove(846, 250, 940, 264, 5, 'pine');
    grove(850, 286, 940, 326, 6, 'pine');
    grove(14, 196, 84, 244, 8, 'pine');
    grove(14, 384, 84, 430, 6, 'pine');
  } else {
    back.push(
      <g key={key()}>
        <path d={COAST} stroke="#eadfb4" strokeWidth={16} fill="none" strokeLinecap="round" />
        <path d={`${COAST} L970 450 L970 -10 Z`} fill={SEA} />
        <path d={COAST} stroke="#f4efe0" strokeWidth={1.6} fill="none" opacity={0.8} />
        <path d={COAST} stroke={WATER_L} strokeWidth={1} fill="none" opacity={0.6} strokeDasharray="26 18" transform="translate(11 0)" />
        <path d={COAST} stroke={WATER_L} strokeWidth={0.8} fill="none" opacity={0.45} strokeDasharray="14 30" transform="translate(24 0)" />
        {[[904, 64], [930, 150], [898, 232], [936, 300], [900, 392]].map(([x, y]) => (
          <path key={`${x}-${y}`} d={`M${x} ${y}q5 -4 10 0t10 0`} stroke={PAPER} strokeWidth={1} fill="none" opacity={0.5} />
        ))}
      </g>,
    );
    fields(14, 180, 84, 236, 35, 28, 0.6);
    fields(14, 306, 84, 340, 35, 34, 0.7);
    fields(786, 24, 846, 174, 30, 30, 0.7);
    grove(16, 14, 92, 56, 6, 'pine');
    grove(14, 384, 84, 430, 6, 'leaf');
    grove(788, 190, 836, 250, 5, 'pine');
    // harbour: a pier at the end of the highway, boats, a fishing hamlet, a lighthouse
    front.push(
      <g key={key()}>
        <rect x={854} y={339.5} width={50} height={8} fill={WOOD} stroke={INK} strokeWidth={0.7} transform="rotate(-4 854 344)" />
        <path d="M862 339 v8 M872 338 v8 M882 337.5 v8 M892 337 v8" stroke={WOOD_D} strokeWidth={0.6} transform="rotate(-4 854 344)" />
        {[[906, 96, -24], [928, 214, 14], [912, 356, 6], [896, 322, -10]].map(([x, y, r]) => (
          <Boat key={`${x}-${y}`} x={x as number} y={y as number} turn={r as number} />
        ))}
      </g>,
    );
    scene.roof(796, 362, 20, 14, 'thatch', 2.5);
    scene.roof(822, 364, 18, 13, 'wood', 2.5);
    scene.roof(806, 384, 20, 14, 'thatch', 2.5);
    scene.sweep(852, 122, 8, 8, 12);
    scene.add(
      <>
        <circle cx={856} cy={126} r={5} fill={PLASTER} stroke={INK} strokeWidth={0.8} />
        <circle cx={856} cy={126} r={2.2} fill={RED} />
      </>,
    );
    scene.light(856, 126, 22);
  }

  // willows and alders along the river
  for (const [x, y, r] of [[182, 66, 6], [168, 122, 5], [174, 236, 5.5], [118, 62, 7], [100, 176, 6], [112, 268, 7], [126, 318, 5]]) {
    scene.tree(x as number, y as number, r as number, 'leaf');
  }

  return { back, front };
}

// --------------------------------------------------------------------- town

interface House {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: RoofKind;
  prio: number;
}

/**
 * Every house plot of the town, nearest the crossroads first. The plan depends
 * only on the province, so the same houses stay put while new ones are added.
 */
function townPlan(seed: string): House[] {
  const rng = createRng(`${seed}:houses`);
  const out: House[] = [];
  const block = (x0: number, y0: number, x1: number, y1: number, cw: number, ch: number, kinds: RoofKind[], bias: number) => {
    for (let y = y0; y + ch <= y1 + 0.5; y += ch + 4) {
      for (let x = x0; x + cw <= x1 + 0.5; x += cw + 4) {
        const w = cw - rng.range(0, 5);
        const h = ch - rng.range(0, 4);
        const kind = kinds[rng.int(0, kinds.length - 1)] ?? 'tile';
        const ox = rng.range(0, cw - w);
        const oy = rng.range(0, ch - h);
        const prio = Math.hypot(x + cw / 2 - 480, y + ch / 2 - 350) + rng.range(0, 70) + bias;
        if (!rng.chance(0.08)) out.push({ x: x + ox, y: y + oy, w, h, kind, prio });
      }
    }
  };
  block(388, 308, 468, 334, 24, 20, ['tile', 'wood'], -40); // between the castle and the highway
  block(386, 370, 434, 432, 22, 18, ['wood', 'tile', 'thatch'], -20); // south-west of the crossroads
  block(494, 402, 764, 428, 23, 19, ['wood', 'tile', 'thatch'], 0); // behind the market
  block(596, 170, 660, 312, 28, 19, ['tile', 'wood'], 0); // east quarter, inner
  block(682, 170, 766, 312, 25, 19, ['wood', 'thatch', 'tile'], 30); // east quarter, outer
  block(398, 40, 470, 90, 32, 21, ['tile'], 60); // retainers' residences north of the castle
  block(490, 40, 566, 90, 32, 21, ['tile'], 60);
  block(22, 252, 84, 298, 26, 18, ['thatch'], 170); // hamlet across the river
  return out.sort((a, b) => a.prio - b.prio);
}

// ------------------------------------------------------------------ furniture

function Tag({ x, y, type, level, building, scale = 1, centred = false }: { x: number; y: number; type: BuildingType; level: number; building: boolean; scale?: number; centred?: boolean }) {
  const label = `${BUILDINGS[type].name} ${level > 0 ? level : '—'}`;
  const width = 34 + label.length * 6.6;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale}) translate(${centred ? -width / 2 : 0} 0)`}>
      <rect x={1.5} y={2} width={width} height={22} rx={3} fill={SHADOW} opacity={0.3} />
      <rect x={0} y={0} width={width} height={22} rx={3} fill={PAPER} stroke={INK} strokeWidth={1} />
      <rect x={0} y={0} width={22} height={22} rx={3} fill={building ? GOLD : RED} />
      <g style={{ color: building ? INK : PAPER }}>
        <Icon name={type} size={15} x={3.5} y={3.5} strokeWidth={2} />
      </g>
      <text x={28} y={15.5} fontSize={11.5} fontWeight={700} fill={INK}>
        {label}
      </text>
    </g>
  );
}

function Lot({ x, y, w, h, label }: { x: number; y: number; w: number; h: number; label: string }) {
  return (
    <g opacity={0.6}>
      <rect x={x} y={y} width={w} height={h} rx={4} fill={EARTH} fillOpacity={0.35} stroke={INK} strokeWidth={1.1} strokeDasharray="5 5" />
      <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" fontSize={11} fill={INK} fontStyle="italic">
        {label}
      </text>
    </g>
  );
}

function Boat({ x, y, turn, sail = true }: { x: number; y: number; turn: number; sail?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${turn})`}>
      <path d="M-9 0 Q0 -5 9 0 Q0 5 -9 0 Z" fill={WOOD_D} stroke={INK} strokeWidth={0.6} />
      {sail ? <path d="M-2 -1 L5 -7 L4 1 Z" fill={PLASTER} stroke={INK} strokeWidth={0.5} /> : <path d="M-4 0h8" stroke={PAPER} strokeWidth={1.4} opacity={0.7} />}
    </g>
  );
}

function Flag({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g>
      <rect x={x + 0.8} y={y - 9.5} width={5.5} height={9.5} fill={color} stroke={INK} strokeWidth={0.5} />
      <circle cx={x + 3.5} cy={y - 6} r={1.2} fill={PAPER} />
      <circle cx={x} cy={y} r={1.2} fill={INK} />
    </g>
  );
}

const NORENS = [RED, '#31487a', '#b8862f', '#2f6b4f', '#7a4a6e'];

/** Where the amber "under construction" outline goes for each building. */
const WORKSITES: Record<BuildingType, [number, number, number, number]> = {
  castle: [432, 138, 96, 96],
  farm: [292, 164, 78, 54],
  market: [488, 320, 180, 78],
  barracks: [200, 36, 164, 118],
  dojo: [596, 36, 164, 118],
};

function CityViewImpl({ name, terrain, levels, upgrading, bannerHex, hour, className }: CityViewProps) {
  const night = hour >= 19 || hour < 5;
  const dusk = !night && (hour < 7 || hour >= 17);
  const development = levels.castle + levels.farm + levels.market + levels.barracks + levels.dojo;
  const id = `city-${name.replace(/[^a-z0-9]/gi, '')}`;
  const coast = terrain === 'coast';

  const scene = createScene();
  const land = buildTerrain(terrain, id, name, scene);

  // ------------------------------------------------------------ open ground
  const grass: ReactNode[] = [];
  const meadow = createRng(`${name}:grass`);
  for (let i = 0; i < 90; i++) {
    const x = meadow.range(12, W - 12);
    const y = meadow.range(12, H - 12);
    grass.push(<path key={i} d={`M${x.toFixed(1)} ${y.toFixed(1)}q1.6 -3.6 3.2 0m1.6 .4q1.6 -3.2 3.2 0`} />);
  }

  // ---------------------------------------------------------------- roads
  const highway = `M-10 358 L150 350 H770 ${coast ? 'L858 344' : 'L970 338'}`;
  const roads: [string, number][] = [
    [highway, 13],
    ['M480 284 V452', 13],
    [RING, 9],
    ['M480 97 V-10', 8],
    ['M670 152 V350', 8],
    ['M585 160 H772 V350', 6.5],
    ['M360 80 L388 108', 7],
    ['M366 190 H377', 7],
    ['M494 396 H764', 5],
  ];

  // ---------------------------------------------------------------- castle
  const walled = levels.castle >= 3;
  const moat = levels.castle >= 8;
  const tiers = clamp(levels.castle, 1, 5);
  const KX = 480;
  const KY = 186;
  const tierSize = (i: number) => 34 + (tiers - 1 - i) * 10;
  const base = tierSize(0) + 14;

  scene.sweep(KX - tierSize(0) / 2, KY - tierSize(0) / 2, tierSize(0), tierSize(0), 5 + tiers * 3);
  for (let i = 0; i < tiers; i++) {
    const s = tierSize(i);
    if (i > 0) scene.add(<rect x={KX - s / 2 + 2.5} y={KY - s / 2 + 4.6} width={s} height={s} fill={SHADOW} opacity={0.3} />);
    scene.add(<rect x={KX - s / 2 - 1.3} y={KY - s / 2 - 1.3} width={s + 2.6} height={s + 2.6} fill={PLASTER} stroke={INK} strokeWidth={0.45} />);
    scene.pyramid(KX, KY, s, i === tiers - 1 ? 'keepTop' : 'keep', i === tiers - 1 ? s * 0.2 : 0);
  }
  const topRidge = tierSize(tiers - 1) * 0.2;
  scene.add(
    <>
      <circle cx={KX - topRidge} cy={KY} r={1.9} fill={GOLD} stroke={INK} strokeWidth={0.5} />
      <circle cx={KX + topRidge} cy={KY} r={1.9} fill={GOLD} stroke={INK} strokeWidth={0.5} />
    </>,
  );
  scene.light(KX, KY, 30);
  if (walled) {
    scene.roof(462, 256, 36, 13, 'keep', 3.5); // gatehouse
    scene.roof(416, 236, 42, 18, 'keep', 3); // the lord's residence
    scene.roof(416, 210, 16, 28, 'keep', 3);
    scene.light(436, 245);
  }
  if (levels.castle >= 5) scene.roof(527, 206, 17, 26, 'keep', 3);
  if (levels.castle >= 6) {
    for (const [x, y] of [[415, 137], [545, 137], [415, 259], [545, 259]]) {
      scene.sweep((x as number) - 8, (y as number) - 8, 16, 16, 5);
      scene.add(<rect x={(x as number) - 9.2} y={(y as number) - 9.2} width={18.4} height={18.4} fill={PLASTER} stroke={INK} strokeWidth={0.45} />);
      scene.pyramid(x as number, y as number, 16, 'keep');
    }
  }
  if (levels.castle >= 2) {
    scene.add(
      <>
        <Flag x={466} y={292} color={bannerHex} />
        <Flag x={490} y={292} color={bannerHex} />
        <Flag x={KX - base / 2 + 1} y={KY + base / 2 + 4} color={bannerHex} />
        <Flag x={KX + base / 2 - 7} y={KY + base / 2 + 4} color={bannerHex} />
      </>,
    );
  }
  scene.tree(419, 143, 5.5);
  scene.tree(430, 152, 4);
  scene.tree(541, 250, 5);
  scene.tree(530, 257, 3.6);
  if (walled) {
    scene.tree(520, 142, 4.2, 'blossom');
    scene.tree(541, 176, 3.8, 'blossom');
  }

  // --------------------------------------------------------------- barracks
  const brk = levels.barracks;
  if (brk > 0) {
    scene.roof(228, 48, 84, 22, 'tile', 3.5);
    scene.light(250, 59);
    scene.light(292, 59);
    if (brk >= 3) scene.roof(228, 76, 70, 18, 'wood', 3);
    if (brk >= 4) {
      scene.add(<rect x={318} y={44} width={36} height={32} fill={PLASTER} stroke={INK} strokeWidth={0.7} />);
      scene.roof(320, 46, 32, 28, 'brick', 4);
    }
    if (brk >= 5) scene.roof(210, 104, 14, 38, 'wood', 3);
    if (brk >= 6) {
      scene.sweep(207, 43, 14, 14, 13);
      scene.pyramid(214, 50, 14, 'wood');
      scene.add(<path d="M214 50 h9 l-2.5 2.5 l2.5 2.5 h-9 z" fill={RED} stroke={INK} strokeWidth={0.4} />);
    }
    scene.add(<Flag x={364} y={72} color={RED} />);
  }

  // ------------------------------------------------------------------- dojo
  const dojo = levels.dojo;
  if (dojo > 0) {
    scene.roof(630, 48, 78, 40, 'tile', 4.5, 0.7);
    scene.add(
      <>
        <circle cx={644} cy={68} r={1.7} fill={GOLD} stroke={INK} strokeWidth={0.4} />
        <circle cx={694} cy={68} r={1.7} fill={GOLD} stroke={INK} strokeWidth={0.4} />
      </>,
    );
    scene.light(669, 68, 14);
    if (dojo >= 2) scene.roof(732, 48, 17, 58, 'wood', 3);
    if (dojo >= 6) scene.roof(606, 100, 18, 42, 'tile', 3);
    scene.tree(609, 50, 4.6);
    scene.tree(611, 86, 4.4, 'blossom');
    scene.tree(622, 93, 3.4, 'blossom');
  }

  // ------------------------------------------------------------------- farm
  const farm = levels.farm;
  if (farm > 0) {
    scene.roof(322, 172, 40, 24, 'thatch', 3.5, 0.7);
    scene.light(342, 184);
    if (farm >= 3) {
      scene.add(<rect x={298} y={172} width={20} height={25} fill={PLASTER} stroke={INK} strokeWidth={0.7} />);
      scene.roof(300.5, 174.5, 15, 20, 'tile', 3.5);
    }
    if (farm >= 5) scene.roof(300, 201, 30, 11, 'wood', 2.5);
    if (farm >= 6) {
      scene.roof(168, 148, 19, 15, 'wood', 3);
      scene.add(
        <>
          <rect x={183} y={164} width={5} height={13} fill={WOOD_D} stroke={INK} strokeWidth={0.6} />
          <path d="M183 167.2h5M183 170.5h5M183 173.8h5" stroke={PAPER} strokeWidth={0.6} opacity={0.7} />
        </>,
      );
    }
    scene.add(
      <>
        {Array.from({ length: clamp(farm, 1, 4) }, (_, i) => (
          <circle key={i} cx={338 + i * 7} cy={204 + (i % 2) * 5} r={2.8} fill="#d2b468" stroke={INK} strokeWidth={0.5} />
        ))}
      </>,
    );
    scene.tree(304, 166, 4.2, 'leaf');
  }

  // ----------------------------------------------------------------- market
  const market = levels.market;
  const shopSlots: [number, number, boolean][] = [];
  for (let i = 0; i < 8; i++) {
    if (i < 6) shopSlots.push([500 + i * 27, 326, true]);
    shopSlots.push([546 + i * 27, 359, false]);
  }
  const shopCount = market > 0 ? Math.min(shopSlots.length, 1 + Math.round(market * 1.3)) : 0;
  shopSlots.slice(0, shopCount).forEach(([x, y, north], i) => {
    scene.roof(x, y, 24, 16, i % 3 === 1 ? 'wood' : 'tile', 2.6);
    scene.add(<rect x={x + 2} y={north ? y + 16 : y - 2.4} width={20} height={2.4} fill={NORENS[i % NORENS.length]} stroke={INK} strokeWidth={0.3} />);
    scene.light(x + 12, north ? y + 17 : y - 1, 7);
  });
  if (market >= 3) {
    scene.add(<rect x={680} y={312} width={52} height={32} fill={PLASTER} stroke={INK} strokeWidth={0.7} />);
    scene.roof(682, 314, 48, 28, 'brick', 4.5, 0.6);
    scene.light(706, 344, 9);
  }
  if (market >= 2) {
    const stalls = [[498, 363], [512, 363], [526, 363], [498, 377], [512, 377]];
    scene.add(
      <>
        {stalls.slice(0, Math.min(stalls.length, market)).map(([x, y], i) => (
          <g key={i}>
            <rect x={(x as number) + 1.2} y={(y as number) + 1.6} width={10} height={8} fill={SHADOW} opacity={0.25} />
            <rect x={x} y={y} width={10} height={8} fill={NORENS[(i + 1) % NORENS.length]} stroke={INK} strokeWidth={0.5} />
            <path d={`M${x} ${(y as number) + 4}h10`} stroke={PAPER} strokeWidth={0.8} opacity={0.75} />
          </g>
        ))}
      </>,
    );
  }
  if (market >= 5) {
    scene.sweep(523, 379, 13, 13, 15);
    scene.pyramid(529.5, 385.5, 13, 'brick');
    scene.add(
      <>
        <circle cx={529.5} cy={385.5} r={3.4} fill={PLASTER} stroke={INK} strokeWidth={0.6} />
        <path d="M529.5 385.5v-2.4M529.5 385.5h1.8" stroke={INK} strokeWidth={0.6} strokeLinecap="round" />
      </>,
    );
  }
  const lampSpots = [[470, 340], [490, 360], [470, 360], [490, 340], [664, 340], [676, 360], [471, 312], [489, 404], [471, 404], [600, 360]];
  const lamps = lampSpots.slice(0, clamp(market, 0, lampSpots.length));
  for (const [x, y] of lamps) scene.light(x as number, y as number, 13);

  // ----------------------------------------------------------------- houses
  const plan = townPlan(name);
  const houses = plan.slice(0, Math.min(plan.length, Math.round(6 + development * 2.3)));
  houses.forEach((h, i) => {
    scene.roof(h.x, h.y, h.w, h.h, h.kind, 2.6);
    if (i % 2 === 0) scene.light(h.x + h.w / 2, h.y + h.h / 2, 7);
  });
  const gardens = createRng(`${name}:gardens`);
  houses.forEach((h) => {
    const roll = gardens.next();
    const r = gardens.range(2.6, 3.6);
    if (roll < 0.22 && h.y > 150) scene.tree(h.x + h.w + 1.5, h.y + h.h + 1, r, roll < 0.07 ? 'blossom' : 'leaf');
  });

  // ---------------------------------------------------- telegraph and works
  const telegraph = development >= 5;
  const hwyY = (x: number) => (x <= 150 ? 350 + (150 - x) * 0.05 : 350);
  const poles = [30, 90, 200, 260, 320, 380].map((x) => [x, hwyY(x) + 11.5]);
  if (telegraph) scene.roof(440, 364, 24, 18, 'brick', 3.2);
  const factory = development >= 8;
  if (factory) {
    scene.add(
      <>
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <rect x={781 + i * 13} y={273} width={4.5} height={36} fill="#b9cbc6" />
            <rect x={785.5 + i * 13} y={273} width={8.5} height={36} fill={ROOFS.tile[i % 2 === 0 ? 1 : 2]} />
          </g>
        ))}
        <rect x={781} y={273} width={52} height={36} fill="none" stroke={INK} strokeWidth={0.8} />
        <path d="M794 273v36M807 273v36M820 273v36" stroke={INK} strokeWidth={0.5} opacity={0.6} />
      </>,
    );
    scene.shadows.push(<rect key="factory-shadow" x={785} y={278} width={52} height={36} />);
    scene.sweep(821, 313, 10, 10, 20);
    scene.add(
      <>
        <circle cx={826} cy={318} r={5.4} fill={ROOFS.brick[1]} stroke={INK} strokeWidth={0.8} />
        <circle cx={826} cy={318} r={2.5} fill={INK} />
      </>,
    );
    scene.light(800, 291, 12);
  }

  // riverside and roadside trees close to the town
  for (const [x, y, r, kind] of [[372, 44, 6.5, 'pine'], [381, 60, 4.6, 'pine'], [579, 52, 6, 'pine'], [586, 70, 4.6, 'pine'], [592, 100, 5.4, 'leaf'], [372, 305, 5.6, 'leaf'], [375, 322, 4.4, 'leaf'], [369, 64, 4.4, 'blossom']] as const) {
    scene.tree(x, y, r, kind);
  }
  if (market >= 1) scene.tree(499, 391, 3.6, 'leaf');

  // ------------------------------------------------------------------ farm land
  const paddySlots: [number, number, number, number][] = [];
  for (const x of [264, 231, 198]) paddySlots.push([x, 176, 31, 36]);
  for (const y of [218, 256, 294]) for (const x of [330, 297, 264, 231, 198]) paddySlots.push([x, y, 31, 34]);
  const planted = clamp(farm * 2, 0, paddySlots.length);
  const paddyTones = [PADDY, '#b4c990', '#9ebd9d'];

  const next = LANDMARKS.filter((m) => levels[m.type] < m.level).slice(0, 2);
  const site = upgrading ? WORKSITES[upgrading] : null;
  const bannerW = 36 + name.length * 16;

  return (
    <figure className={className}>
      <div className="paper overflow-hidden rounded-[3px] border border-gold/40 p-0">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid slice"
          role="img"
          aria-label={`Map of the town of ${name}: ${(['castle', 'farm', 'market', 'barracks', 'dojo'] as const).map((t) => `${BUILDINGS[t].name} level ${levels[t]}`).join(', ')}.`}
          className="block aspect-[4/3] w-full sm:aspect-[24/11]"
        >
          <defs>
            <radialGradient id={`${id}-washL`}>
              <stop offset="0" stopColor={LAND_L} stopOpacity="0.95" />
              <stop offset="1" stopColor={LAND_L} stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${id}-washD`}>
              <stop offset="0" stopColor={LAND_D} stopOpacity="0.7" />
              <stop offset="1" stopColor={LAND_D} stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${id}-town`}>
              <stop offset="0.35" stopColor={EARTH} stopOpacity="0.9" />
              <stop offset="1" stopColor={EARTH} stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${id}-glow`}>
              <stop offset="0" stopColor={LIGHT} stopOpacity="0.85" />
              <stop offset="1" stopColor={LIGHT} stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${id}-vig`} cx="0.5" cy="0.5" r="0.75">
              <stop offset="0.6" stopColor={SHADOW} stopOpacity="0" />
              <stop offset="1" stopColor={SHADOW} stopOpacity="0.3" />
            </radialGradient>
            <pattern id={`${id}-rice`} width="5" height="5" patternUnits="userSpaceOnUse">
              <path d="M0.8 1.5h1.6M3.3 4h1.2" stroke={RICE} strokeWidth="1" strokeLinecap="round" />
            </pattern>
            <pattern id={`${id}-furH`} width="4" height="4" patternUnits="userSpaceOnUse">
              <path d="M0 2h4" stroke={INK} strokeWidth="0.6" opacity="0.2" />
            </pattern>
            <pattern id={`${id}-furV`} width="4" height="4" patternUnits="userSpaceOnUse">
              <path d="M2 0v4" stroke={INK} strokeWidth="0.6" opacity="0.2" />
            </pattern>
            <pattern id={`${id}-hatch`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <path d="M0 3.5h7" stroke={AMBER} strokeWidth="1.6" opacity="0.45" />
            </pattern>
            <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="7" />
              <feColorMatrix type="matrix" values="0 0 0 0 0.13  0 0 0 0 0.1  0 0 0 0 0.07  0 0 0 -1.4 0.74" />
            </filter>
          </defs>

          {/* the land, with lighter and darker washes */}
          <rect width={W} height={H} fill={LAND} />
          <ellipse cx={250} cy={110} rx={300} ry={150} fill={`url(#${id}-washL)`} />
          <ellipse cx={760} cy={340} rx={320} ry={150} fill={`url(#${id}-washL)`} />
          <ellipse cx={840} cy={70} rx={230} ry={130} fill={`url(#${id}-washD)`} />
          <ellipse cx={80} cy={390} rx={210} ry={110} fill={`url(#${id}-washD)`} />
          <g stroke={LEAF} strokeWidth={0.9} fill="none" opacity={0.45} strokeLinecap="round">
            {grass}
          </g>

          {land.back}
          <ellipse cx={556} cy={236} rx={300} ry={250} fill={`url(#${id}-town)`} />

          {/* paddies fed by a channel from the river */}
          {farm > 0 ? (
            <g>
              <path d="M134 168 Q160 164 190 171 L192 333 Q176 340 157 338" stroke={WATER_D} strokeWidth={4.6} fill="none" strokeLinejoin="round" />
              <path d="M134 168 Q160 164 190 171 L192 333 Q176 340 157 338" stroke={WATER} strokeWidth={3} fill="none" strokeLinejoin="round" />
              <path d="M192 215 H363 M192 253 H363 M192 291 H363" stroke={WATER} strokeWidth={1.6} opacity={0.85} />
              {paddySlots.map(([x, y, w, h], i) =>
                i < planted ? (
                  <g key={i}>
                    <rect x={x} y={y} width={w} height={h} rx={1.5} fill={paddyTones[i % 3]} stroke="#8a7f4e" strokeWidth={0.9} />
                    <rect x={x} y={y} width={w} height={h} rx={1.5} fill={`url(#${id}-rice)`} />
                  </g>
                ) : (
                  <rect key={i} x={x} y={y} width={w} height={h} rx={1.5} fill="#d6c98f" fillOpacity={0.45} stroke="#8a7f4e" strokeWidth={0.7} strokeDasharray="3 3" strokeOpacity={0.6} />
                ),
              )}
            </g>
          ) : (
            <Lot x={198} y={176} w={166} h={152} label="fallow fields" />
          )}

          {/* the river */}
          <path d={RIVER} stroke={BANK} strokeWidth={33} fill="none" opacity={0.55} />
          <path d={RIVER} stroke={WATER} strokeWidth={28} fill="none" />
          <path d={RIVER} stroke={WATER_L} strokeWidth={13} fill="none" opacity={0.6} />
          <path d={RIVER} stroke="#fff" strokeWidth={0.8} fill="none" opacity={0.5} strokeDasharray="10 16" />
          <path d={RIVER} stroke={WATER_D} strokeWidth={0.8} fill="none" opacity={0.45} strokeDasharray="6 22" transform="translate(7 0)" />

          {market >= 2 ? <Boat x={141} y={250} turn={73} sail={false} /> : null}
          {market >= 6 ? <Boat x={127} y={164} turn={94} sail={false} /> : null}

          {/* yards and compounds */}
          <rect x={292} y={166} width={76} height={50} rx={4} fill={EARTH} stroke={BANK} strokeWidth={0.6} />
          {brk > 0 ? (
            <g>
              <rect x={204} y={40} width={156} height={110} rx={3} fill={EARTH} stroke={BANK} strokeWidth={0.8} />
              <rect x={206.5} y={42.5} width={151} height={105} rx={2} fill="none" stroke={WOOD_D} strokeWidth={2.2} strokeDasharray="1.4 2.6" />
              <rect x={355} y={74} width={6} height={12} fill={EARTH} />
              <rect x={228} y={102} width={74} height={40} rx={2} fill="#eadbac" stroke="#b39d68" strokeWidth={0.7} strokeDasharray="3 3" />
              <g fill={INK} opacity={0.72}>
                {Array.from({ length: 3 * Math.min(9, 3 + brk) }, (_, i) => {
                  const cols = Math.min(9, 3 + brk);
                  return <circle key={i} cx={236 + (i % cols) * 7.4} cy={113 + Math.floor(i / cols) * 9} r={1.25} />;
                })}
              </g>
              <circle cx={232} cy={108} r={1.6} fill={RED} />
              {brk >= 2 ? (
                <g>
                  <rect x={310} y={84} width={42} height={58} rx={2} fill="#d9d2a0" stroke="#a69a66" strokeWidth={0.6} />
                  <rect x={312} y={85} width={38} height={3.2} fill={WOOD_D} />
                  <path d="M324.5 92v44M337.5 92v44" stroke="#a69a66" strokeWidth={0.5} strokeDasharray="2 3" />
                  <path d="M313 137h36" stroke={WOOD_D} strokeWidth={1.2} strokeDasharray="4 2" />
                  {[318, 331, 344].map((x) => (
                    <g key={x}>
                      <circle cx={x} cy={94} r={4.2} fill={PLASTER} stroke={INK} strokeWidth={0.6} />
                      <circle cx={x} cy={94} r={2.4} fill="none" stroke={INK} strokeWidth={0.6} />
                      <circle cx={x} cy={94} r={1.1} fill={RED} />
                    </g>
                  ))}
                </g>
              ) : null}
            </g>
          ) : (
            <Lot x={204} y={40} w={156} h={110} label="ground for a barracks" />
          )}
          {dojo > 0 ? (
            <g>
              <rect x={600} y={40} width={156} height={110} rx={2} fill="#e2dbb2" />
              <rect x={602} y={42} width={152} height={106} fill="none" stroke={INK} strokeWidth={4.2} />
              <rect x={602} y={42} width={152} height={106} fill="none" stroke={PLASTER} strokeWidth={2.8} />
              <rect x={662} y={144} width={16} height={8} fill="#e2dbb2" />
              <ellipse cx={618} cy={70} rx={12} ry={15} fill="#bfc891" opacity={0.85} />
              <ellipse cx={617} cy={66} rx={7.5} ry={5} fill={WATER} stroke={WATER_D} strokeWidth={0.6} />
              <path d="M670 144 V96" stroke={ROAD} strokeWidth={6} strokeLinecap="round" opacity={0.9} />
              {dojo >= 2 ? (
                <g>
                  <rect x={708} y={112} width={42} height={32} rx={2} fill="#d3c088" stroke={WOOD_D} strokeWidth={1.2} strokeDasharray="5 2" />
                  {[[720, 122, 20], [736, 132, -30], [728, 137, 80]].slice(0, Math.min(3, dojo - 1)).map(([x, y, r]) => (
                    <g key={`${x}`} transform={`translate(${x} ${y}) rotate(${r})`} fill={INK}>
                      <ellipse cx={0} cy={0} rx={3.6} ry={1.7} />
                      <ellipse cx={4.2} cy={-0.6} rx={1.5} ry={1} />
                    </g>
                  ))}
                </g>
              ) : null}
              {dojo >= 4 ? (
                <g>
                  {Array.from({ length: 12 }, (_, i) => {
                    const x = 634 + (i % 4) * 9 + (i % 4 >= 2 ? 30 : 0);
                    const y = 104 + Math.floor(i / 4) * 11;
                    return (
                      <g key={i}>
                        <circle cx={x + 1.2} cy={y + 1.5} r={1.9} fill={SHADOW} opacity={0.3} />
                        <circle cx={x} cy={y} r={1.9} fill={WOOD} stroke={INK} strokeWidth={0.5} />
                      </g>
                    );
                  })}
                </g>
              ) : null}
            </g>
          ) : (
            <Lot x={600} y={40} w={156} h={110} label="ground for an academy" />
          )}
          {market > 0 ? (
            <g>
              <rect x={492} y={358} width={48} height={36} rx={2} fill="#eadcb0" stroke={ROAD_EDGE} strokeWidth={0.7} />
              <path d="M492 370h48M492 382h48M508 358v36M524 358v36" stroke={ROAD_EDGE} strokeWidth={0.4} opacity={0.5} />
            </g>
          ) : (
            <Lot x={546} y={358} w={214} h={20} label="an empty market street" />
          )}
          {factory ? <rect x={774} y={266} width={66} height={62} rx={3} fill={EARTH} stroke={BANK} strokeWidth={0.7} /> : null}

          {/* roads: all casings first, then all surfaces, so junctions join cleanly */}
          <g fill="none" stroke={ROAD_EDGE} strokeLinecap="round" strokeLinejoin="round">
            {roads.map(([d, w]) => (
              <path key={d} d={d} strokeWidth={w + 1.8} />
            ))}
          </g>
          <g fill="none" stroke={ROAD} strokeLinecap="round" strokeLinejoin="round">
            {roads.map(([d, w]) => (
              <path key={d} d={d} strokeWidth={w} />
            ))}
          </g>
          <g>
            <rect x={128} y={341.5} width={44} height={17} fill={WOOD} stroke={INK} strokeWidth={0.8} />
            <path d="M128 344.2h44M128 355.8h44" stroke={WOOD_D} strokeWidth={1.2} />
            <path d="M136 341.5v17M144 341.5v17M152 341.5v17M160 341.5v17" stroke={WOOD_D} strokeWidth={0.5} />
          </g>
          {dojo > 0 ? (
            <g>
              <rect x={659} y={155.4} width={22} height={3} fill={RED} stroke={INK} strokeWidth={0.4} />
              <circle cx={661.5} cy={157} r={1.8} fill={RED} stroke={INK} strokeWidth={0.4} />
              <circle cx={678.5} cy={157} r={1.8} fill={RED} stroke={INK} strokeWidth={0.4} />
            </g>
          ) : null}

          {/* the castle: ditch or moat, the walled bailey, the stone base of the keep */}
          <rect x={394} y={116} width={172} height={164} rx={16} fill={moat ? WATER : EARTH_D} stroke={moat ? WATER_D : BANK} strokeWidth={1} />
          {moat ? (
            <>
              <rect x={398} y={120} width={164} height={156} rx={13} fill="none" stroke={WATER_L} strokeWidth={2.6} opacity={0.75} />
              <rect x={400.5} y={122.5} width={159} height={151} rx={11} fill="none" stroke="#fff" strokeWidth={0.7} strokeDasharray="7 11" opacity={0.5} />
            </>
          ) : (
            <rect x={399} y={121} width={162} height={154} rx={12} fill="none" stroke={BANK} strokeWidth={0.8} strokeDasharray="2 4" opacity={0.8} />
          )}
          {walled ? (
            <>
              <rect x={405} y={127} width={150} height={142} rx={5} fill={STONE_D} stroke={INK} strokeWidth={0.9} />
              <rect x={408} y={130} width={144} height={136} rx={3} fill={STONE} />
              <rect x={411} y={133} width={138} height={130} rx={2} fill="#dfd8b0" />
              <rect x={411} y={133} width={138} height={130} rx={2} fill="none" stroke={INK} strokeWidth={3.8} />
              <rect x={411} y={133} width={138} height={130} rx={2} fill="none" stroke={PLASTER} strokeWidth={2.4} />
            </>
          ) : (
            <>
              <rect x={407} y={129} width={146} height={138} rx={9} fill={EARTH} stroke={BANK} strokeWidth={1} />
              <rect x={411} y={133} width={138} height={130} rx={6} fill="none" stroke={WOOD_D} strokeWidth={2} strokeDasharray="1.4 2.8" />
            </>
          )}
          <ellipse cx={436} cy={156} rx={21} ry={15} fill="#bcc78f" opacity={0.8} />
          <ellipse cx={528} cy={242} rx={18} ry={14} fill="#bcc78f" opacity={0.8} />
          {walled ? <ellipse cx={536} cy={163} rx={8} ry={5.5} fill={WATER} stroke={WATER_D} strokeWidth={0.6} /> : null}
          <path d="M480 262 V226" stroke={ROAD} strokeWidth={7} strokeLinecap="round" />
          <rect x={473} y={262} width={14} height={23} fill={WOOD} stroke={INK} strokeWidth={0.7} />
          <path d="M473 267h14M473 272h14M473 277h14M473 282h14" stroke={WOOD_D} strokeWidth={0.5} />
          <rect x={KX - base / 2} y={KY - base / 2} width={base} height={base} fill={STONE_D} stroke={INK} strokeWidth={0.9} />
          <rect x={KX - base / 2 + 3.5} y={KY - base / 2 + 3.5} width={base - 7} height={base - 7} fill={STONE} stroke={INK} strokeWidth={0.5} strokeOpacity={0.6} />

          {/* shadows, then buildings, then tree crowns */}
          <g fill={SHADOW} opacity={0.26}>
            {scene.shadows}
          </g>
          {scene.bodies}
          {land.front}

          {telegraph ? (
            <g>
              <path d={`M${poles.map((p) => p.join(' ')).join(' L')} L440 365`} stroke={INK} strokeWidth={0.6} fill="none" opacity={0.6} />
              {poles.map(([x, y]) => (
                <g key={x}>
                  <path d={`M${x} ${(y as number) - 3}v6`} stroke={INK} strokeWidth={0.9} />
                  <circle cx={x} cy={y} r={1.5} fill={WOOD_D} stroke={INK} strokeWidth={0.5} />
                </g>
              ))}
            </g>
          ) : null}
          <g>
            {lamps.map(([x, y]) => (
              <g key={`${x}-${y}`}>
                <circle cx={x} cy={y} r={1.9} fill={INK} />
                <circle cx={x} cy={y} r={0.9} fill={LIGHT} />
              </g>
            ))}
          </g>
          {scene.canopy}
          {factory ? (
            <g fill="#f3efe4" stroke="none">
              <circle cx={833} cy={308} r={5} opacity={0.6} />
              <circle cx={843} cy={297} r={7.5} opacity={0.48} />
              <circle cx={857} cy={285} r={10.5} opacity={0.36} />
              <circle cx={875} cy={273} r={14} opacity={0.24} />
            </g>
          ) : null}

          {site ? (
            <g>
              <rect x={site[0]} y={site[1]} width={site[2]} height={site[3]} rx={5} fill={`url(#${id}-hatch)`} />
              <rect x={site[0]} y={site[1]} width={site[2]} height={site[3]} rx={5} fill="none" stroke={INK} strokeWidth={3.4} opacity={0.5} />
              <rect x={site[0]} y={site[1]} width={site[2]} height={site[3]} rx={5} fill="none" stroke={AMBER} strokeWidth={2.2} strokeDasharray="8 6" className="city-build" />
            </g>
          ) : null}

          {/* evening and night washes; lights are drawn above them */}
          {dusk ? <rect width={W} height={H} fill="#f6d3b0" style={{ mixBlendMode: 'multiply' }} /> : null}
          {night ? (
            <>
              <rect width={W} height={H} fill="#46588a" style={{ mixBlendMode: 'multiply' }} />
              <rect width={W} height={H} fill="#0b1020" opacity={0.1} />
              {scene.lights.map(([x, y, r], i) => (
                <g key={i}>
                  <circle cx={x} cy={y} r={r} fill={`url(#${id}-glow)`} />
                  <circle cx={x} cy={y} r={1.2} fill="#fff3c4" />
                </g>
              ))}
            </>
          ) : null}

          {/* paper grain and darker edges */}
          <rect width={W} height={H} filter={`url(#${id}-grain)`} opacity={0.5} />
          <rect width={W} height={H} fill={`url(#${id}-vig)`} />

          {/* frame with survey ticks */}
          <rect x={5} y={5} width={W - 10} height={H - 10} fill="none" stroke={INK} strokeWidth={1.4} opacity={0.7} />
          <rect x={9} y={9} width={W - 18} height={H - 18} fill="none" stroke={INK} strokeWidth={0.5} opacity={0.6} />
          <path
            d={`${Array.from({ length: 23 }, (_, i) => `M${40 + i * 40} 5v4M${40 + i * 40} ${H - 5}v-4`).join('')}${Array.from({ length: 10 }, (_, i) => `M5 ${40 + i * 40}h4M${W - 5} ${40 + i * 40}h-4`).join('')}`}
            stroke={INK}
            strokeWidth={0.8}
            opacity={0.6}
          />

          {/* compass */}
          <g className="hidden sm:block" transform="translate(918 396)">
            <circle r={21} fill={PAPER} opacity={0.82} stroke={INK} strokeWidth={0.8} />
            <circle r={15.5} fill="none" stroke={INK} strokeWidth={0.4} opacity={0.6} />
            <path d="M0 -15 L3.6 0 L0 15 L-3.6 0 Z" fill={INK} opacity={0.8} />
            <path d="M0 -15 L3.6 0 L-3.6 0 Z" fill={RED} />
            <path d="M-15 0 L0 -2.6 L15 0 L0 2.6 Z" fill={INK} opacity={0.35} />
            <text y={-22.5} textAnchor="middle" fontSize={10} fontWeight={800} fill={INK}>
              N
            </text>
          </g>

          {/* name banner: in the corner on wide screens, top centre on a phone */}
          <g className="hidden sm:block" transform="translate(22 20)">
            <rect x={2} y={2.5} width={bannerW} height={34} fill={SHADOW} opacity={0.3} />
            <rect width={bannerW} height={34} fill={RED} stroke={INK} strokeWidth={1.2} />
            <rect x={3} y={3} width={bannerW - 6} height={28} fill="none" stroke={PAPER} strokeWidth={0.8} opacity={0.7} />
            <text x={bannerW / 2 + 1.25} y={24} textAnchor="middle" fontSize={19} fontWeight={800} letterSpacing={2.5} fill={PAPER} className="font-display">
              {name.toUpperCase()}
            </text>
          </g>
          <g className="sm:hidden" transform={`translate(${480 - (bannerW * 0.9) / 2} 12) scale(0.9)`}>
            <rect width={bannerW} height={34} fill={RED} stroke={INK} strokeWidth={1.2} />
            <rect x={3} y={3} width={bannerW - 6} height={28} fill="none" stroke={PAPER} strokeWidth={0.8} opacity={0.7} />
            <text x={bannerW / 2 + 1.25} y={24} textAnchor="middle" fontSize={19} fontWeight={800} letterSpacing={2.5} fill={PAPER} className="font-display">
              {name.toUpperCase()}
            </text>
          </g>

          {/* level tags: a normal set for wide screens, a larger one for phones */}
          <g className="hidden sm:block">
            <Tag x={480} y={90} type="castle" level={levels.castle} building={upgrading === 'castle'} centred />
            <Tag x={206} y={24} type="barracks" level={brk} building={upgrading === 'barracks'} />
            <Tag x={602} y={24} type="dojo" level={dojo} building={upgrading === 'dojo'} />
            <Tag x={198} y={152} type="farm" level={farm} building={upgrading === 'farm'} />
            <Tag x={550} y={378} type="market" level={market} building={upgrading === 'market'} />
          </g>
          <g className="sm:hidden">
            <Tag x={480} y={92} type="castle" level={levels.castle} building={upgrading === 'castle'} scale={1.42} centred />
            <Tag x={200} y={12} type="barracks" level={brk} building={upgrading === 'barracks'} scale={1.42} />
            <Tag x={604} y={12} type="dojo" level={dojo} building={upgrading === 'dojo'} scale={1.42} />
            <Tag x={196} y={150} type="farm" level={farm} building={upgrading === 'farm'} scale={1.42} />
            <Tag x={548} y={380} type="market" level={market} building={upgrading === 'market'} scale={1.42} />
          </g>
        </svg>
      </div>
      <figcaption className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          <span className="font-display text-sm font-bold text-parchment">{name}</span> seen from above
          {night ? ', by night' : dusk ? ', in the low sun' : ''}. Everything you build appears on the map.
        </span>
        {next.length > 0 ? (
          <span>
            Next: {next.map((m) => `${BUILDINGS[m.type].name} Lv ${m.level} — ${m.text}`).join(' · ')}
          </span>
        ) : (
          <span>A town in full flower.</span>
        )}
      </figcaption>
    </figure>
  );
}

/** The map only changes when a level, the hour band or the work in progress does. */
export const CityView = memo(CityViewImpl, (a, b) => {
  const band = (h: number) => (h >= 19 || h < 5 ? 2 : h < 7 || h >= 17 ? 1 : 0);
  return (
    a.name === b.name &&
    a.terrain === b.terrain &&
    a.upgrading === b.upgrading &&
    a.bannerHex === b.bannerHex &&
    a.className === b.className &&
    band(a.hour) === band(b.hour) &&
    a.levels.castle === b.levels.castle &&
    a.levels.farm === b.levels.farm &&
    a.levels.market === b.levels.market &&
    a.levels.barracks === b.levels.barracks &&
    a.levels.dojo === b.levels.dojo
  );
});
