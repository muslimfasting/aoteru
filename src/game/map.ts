/**
 * World geography.
 *
 * All seven regions of Japan are defined (MAP-01), but the first playable
 * prototype opens only Kansai: ten provinces around the capital, with borders
 * simplified for gameplay. Geometry lives here so the server (adjacency,
 * travel) and the client (rendering) read the same source.
 */
import type { ResourceBag, Terrain, UnitCounts } from './config';

export interface RegionDef {
  id: string;
  name: string;
  kanji: string;
  identity: string;
  playable: boolean;
}

export const REGIONS: RegionDef[] = [
  { id: 'tohoku', name: 'Tohoku', kanji: '東北', identity: 'Northern frontier and resources', playable: false },
  { id: 'kanto', name: 'Kanto', kanji: '関東', identity: 'Population and agriculture', playable: false },
  { id: 'chubu', name: 'Chubu', kanji: '中部', identity: 'Mountain passes and defense', playable: false },
  { id: 'kansai', name: 'Kansai', kanji: '関西', identity: 'Political and cultural center', playable: true },
  { id: 'chugoku', name: 'Chugoku', kanji: '中国', identity: 'Trade and strategic routes', playable: false },
  { id: 'shikoku', name: 'Shikoku', kanji: '四国', identity: 'Island defense', playable: false },
  { id: 'kyushu', name: 'Kyushu', kanji: '九州', identity: 'Ports and military expansion', playable: false },
];

export type Point = readonly [number, number];

export const MAP_SIZE = { width: 1000, height: 940 } as const;

/** Shared border vertices. Provinces reference these so that borders line up exactly. */
const V = {
  // Tanba
  T1: [140, 150], T2: [260, 90], T3: [400, 110], T4: [470, 170], T5: [480, 260], T6: [440, 330], T7: [300, 340], T8: [170, 320],
  // Omi
  O1: [540, 70], O2: [700, 60], O3: [800, 150], O4: [810, 300], O5: [740, 400], O6: [620, 410], O7: [560, 330],
  // Yamashiro
  Y1: [590, 470], Y2: [500, 480], Y3: [440, 440],
  // Settsu and the Osaka Bay shore
  S1: [400, 490], S2: [340, 460], S3: [160, 400], S4: [250, 430],
  // Izumi / Kawachi
  K1: [420, 610], K2: [510, 630], I1: [330, 690], I2: [240, 670], I3: [285, 560],
  // Yamato / Iga
  M1: [650, 540], M2: [680, 680], M3: [600, 740], G1: [750, 500],
  // Ise and the Ise Bay shore
  E1: [880, 330], E2: [860, 450], E3: [830, 580], E4: [880, 680], E5: [790, 760], E6: [720, 790],
  // Kii and the southern coast
  C1: [690, 860], C2: [560, 900], C3: [420, 880], C4: [300, 800], C5: [230, 730],
} as const satisfies Record<string, Point>;

export interface ProvinceDef {
  code: string;
  name: string;
  kanji: string;
  region: string;
  terrain: Terrain;
  population: number;
  base: ResourceBag;
  /** New players may found their clan here while it is unclaimed. */
  startSlot: boolean;
  /** NPC clan that holds the province when the world is created. */
  initialOwner?: string;
  /** Local warriors holding the province while no clan rules it. */
  neutralGarrison: Partial<UnitCounts>;
  castleLevel: number;
  polygon: Point[];
  /** Where the name and castle marker sit. */
  label: Point;
  neighbors: string[];
  lore: string;
}

export const PROVINCES: ProvinceDef[] = [
  {
    code: 'tanba',
    name: 'Tanba',
    kanji: '丹波',
    region: 'kansai',
    terrain: 'mountains',
    population: 3200,
    base: { food: 110, gold: 90, wood: 130, stone: 60, iron: 30 },
    startSlot: true,
    neutralGarrison: { ashigaru: 90, yari: 20, archer: 30 },
    castleLevel: 1,
    polygon: [V.T1, V.T2, V.T3, V.T4, V.T5, V.T6, V.T7, V.T8],
    label: [305, 215],
    neighbors: ['yamashiro', 'settsu', 'omi'],
    lore: 'Forested highlands guarding the north-western road to the capital.',
  },
  {
    code: 'omi',
    name: 'Omi',
    kanji: '近江',
    region: 'kansai',
    terrain: 'plains',
    population: 5200,
    base: { food: 180, gold: 140, wood: 90, stone: 40, iron: 35 },
    startSlot: false,
    initialOwner: 'rokkaku',
    neutralGarrison: { ashigaru: 150, yari: 60, archer: 40 },
    castleLevel: 2,
    polygon: [V.T4, V.O1, V.O2, V.O3, V.O4, V.O5, V.O6, V.O7, V.T5],
    label: [725, 235],
    neighbors: ['tanba', 'yamashiro', 'iga', 'ise'],
    lore: 'Rice country around the great lake, crossed by every road to the east.',
  },
  {
    code: 'yamashiro',
    name: 'Yamashiro',
    kanji: '山城',
    region: 'kansai',
    terrain: 'plains',
    population: 6000,
    base: { food: 130, gold: 220, wood: 60, stone: 30, iron: 20 },
    startSlot: false,
    neutralGarrison: { ashigaru: 250, yari: 120, archer: 100, samurai: 60, cavalry: 30 },
    castleLevel: 3,
    polygon: [V.T5, V.O7, V.O6, V.Y1, V.Y2, V.Y3, V.T6],
    label: [512, 392],
    neighbors: ['tanba', 'omi', 'settsu', 'kawachi', 'yamato', 'iga'],
    lore: 'The imperial capital. Whoever holds it speaks with the authority of the court.',
  },
  {
    code: 'settsu',
    name: 'Settsu',
    kanji: '摂津',
    region: 'kansai',
    terrain: 'coast',
    population: 5000,
    base: { food: 140, gold: 190, wood: 75, stone: 35, iron: 20 },
    startSlot: false,
    initialOwner: 'miyoshi',
    neutralGarrison: { ashigaru: 150, yari: 60, archer: 40 },
    castleLevel: 2,
    polygon: [V.T8, V.T7, V.T6, V.Y3, V.S1, V.S2, V.S4, V.S3],
    label: [305, 392],
    neighbors: ['tanba', 'yamashiro', 'kawachi', 'izumi'],
    lore: 'Harbours on the inner sea, rich with merchant tolls.',
  },
  {
    code: 'kawachi',
    name: 'Kawachi',
    kanji: '河内',
    region: 'kansai',
    terrain: 'plains',
    population: 4200,
    base: { food: 170, gold: 120, wood: 60, stone: 30, iron: 15 },
    startSlot: false,
    neutralGarrison: { ashigaru: 150, yari: 60, archer: 50 },
    castleLevel: 1,
    polygon: [V.Y3, V.Y2, V.K2, V.K1, V.S1],
    label: [455, 540],
    neighbors: ['yamashiro', 'settsu', 'izumi', 'yamato', 'kii'],
    lore: 'A narrow, fertile plain between the bay and the Yamato hills.',
  },
  {
    code: 'izumi',
    name: 'Izumi',
    kanji: '和泉',
    region: 'kansai',
    terrain: 'coast',
    population: 3400,
    base: { food: 120, gold: 150, wood: 70, stone: 30, iron: 20 },
    startSlot: true,
    neutralGarrison: { ashigaru: 90, yari: 20, archer: 30 },
    castleLevel: 1,
    polygon: [V.S2, V.S1, V.K1, V.I1, V.I2, V.I3],
    label: [338, 590],
    neighbors: ['settsu', 'kawachi', 'kii'],
    lore: 'A trading shore where foreign goods and new ideas first come ashore.',
  },
  {
    code: 'yamato',
    name: 'Yamato',
    kanji: '大和',
    region: 'kansai',
    terrain: 'hills',
    population: 4600,
    base: { food: 150, gold: 130, wood: 90, stone: 55, iron: 25 },
    startSlot: false,
    neutralGarrison: { ashigaru: 140, yari: 70, archer: 50 },
    castleLevel: 1,
    polygon: [V.Y2, V.Y1, V.M1, V.M2, V.M3, V.K2],
    label: [588, 600],
    neighbors: ['yamashiro', 'kawachi', 'iga', 'ise', 'kii'],
    lore: 'The old heartland, ruled as much by its great temples as by any lord.',
  },
  {
    code: 'iga',
    name: 'Iga',
    kanji: '伊賀',
    region: 'kansai',
    terrain: 'mountains',
    population: 2600,
    base: { food: 95, gold: 80, wood: 125, stone: 60, iron: 40 },
    startSlot: true,
    neutralGarrison: { ashigaru: 90, yari: 20, archer: 30 },
    castleLevel: 1,
    polygon: [V.O6, V.O5, V.G1, V.M1, V.Y1],
    label: [672, 462],
    neighbors: ['yamashiro', 'omi', 'ise', 'yamato'],
    lore: 'A ring of mountains whose villages answer to no one and watch everyone.',
  },
  {
    code: 'ise',
    name: 'Ise',
    kanji: '伊勢',
    region: 'kansai',
    terrain: 'coast',
    population: 4000,
    base: { food: 150, gold: 130, wood: 90, stone: 35, iron: 20 },
    startSlot: true,
    neutralGarrison: { ashigaru: 90, yari: 20, archer: 30 },
    castleLevel: 1,
    polygon: [V.O4, V.E1, V.E2, V.E3, V.E4, V.E5, V.E6, V.M2, V.M1, V.G1, V.O5],
    label: [775, 625],
    neighbors: ['omi', 'iga', 'yamato', 'kii'],
    lore: 'Pilgrim roads and a long bay shore leading toward the eastern provinces.',
  },
  {
    code: 'kii',
    name: 'Kii',
    kanji: '紀伊',
    region: 'kansai',
    terrain: 'mountains',
    population: 3000,
    base: { food: 105, gold: 85, wood: 160, stone: 65, iron: 30 },
    startSlot: true,
    neutralGarrison: { ashigaru: 90, yari: 20, archer: 30 },
    castleLevel: 1,
    polygon: [V.I2, V.I1, V.K1, V.K2, V.M3, V.M2, V.E6, V.C1, V.C2, V.C3, V.C4, V.C5],
    label: [470, 775],
    neighbors: ['izumi', 'kawachi', 'yamato', 'ise'],
    lore: 'Deep cedar forests and warrior monks at the southern edge of the realm.',
  },
];

export const PROVINCE_BY_CODE: Record<string, ProvinceDef> = Object.fromEntries(PROVINCES.map((p) => [p.code, p]));

/** Scenery drawn behind the playable provinces. */
const LAND: Point[] = [
  [0, 0], [1000, 0], [1000, 300], [930, 312], V.E1, V.E2, V.E3, V.E4, V.E5, V.E6,
  V.C1, V.C2, V.C3, V.C4, V.C5, V.I2, V.I3, V.S2, V.S4, V.S3, [80, 418], [0, 430],
];
const LAKE_BIWA: Point[] = [
  [610, 130], [655, 150], [668, 215], [640, 285], [605, 310], [590, 275], [612, 225], [598, 165],
];
const AWAJI: Point[] = [
  [120, 520], [165, 500], [190, 545], [170, 610], [125, 640], [100, 590],
];

export interface MapLabel {
  text: string;
  at: Point;
  kind: 'sea' | 'lake' | 'land';
}

const DECOR_LABELS: MapLabel[] = [
  { text: 'Osaka Bay', at: [215, 520], kind: 'sea' },
  { text: 'Ise Bay', at: [925, 520], kind: 'sea' },
  { text: 'Kii Channel', at: [150, 800], kind: 'sea' },
  { text: 'Lake Biwa', at: [628, 222], kind: 'lake' },
  { text: 'Harima', at: [70, 300], kind: 'land' },
  { text: 'Tango', at: [300, 45], kind: 'land' },
  { text: 'Echizen', at: [620, 30], kind: 'land' },
  { text: 'Mino', at: [905, 190], kind: 'land' },
];

export const MAP_DECOR = {
  /** Mainland silhouette, including lands outside the prototype region. */
  land: LAND,
  lakeBiwa: LAKE_BIWA,
  awaji: AWAJI,
  labels: DECOR_LABELS,
};

export function areNeighbors(a: string, b: string): boolean {
  return PROVINCE_BY_CODE[a]?.neighbors.includes(b) ?? false;
}

/**
 * Cheapest route from `from` to `to` where every province before the
 * destination satisfies `canPass` (an army may only march through land its
 * clan holds). Returns the list of provinces entered, or null if unreachable.
 */
export function findRoute(
  from: string,
  to: string,
  canPass: (code: string) => boolean,
  cost: (code: string) => number,
): string[] | null {
  if (from === to || !PROVINCE_BY_CODE[from] || !PROVINCE_BY_CODE[to]) return null;
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const open = new Set<string>([from]);
  while (open.size > 0) {
    let current: string | null = null;
    for (const code of open) {
      if (current === null || dist.get(code)! < dist.get(current)!) current = code;
    }
    if (current === null) break;
    open.delete(current);
    if (current === to) break;
    if (current !== from && !canPass(current)) continue;
    for (const next of PROVINCE_BY_CODE[current].neighbors) {
      const d = dist.get(current)! + cost(next);
      if (d < (dist.get(next) ?? Infinity)) {
        dist.set(next, d);
        prev.set(next, current);
        open.add(next);
      }
    }
  }
  if (!prev.has(to)) return null;
  const route: string[] = [];
  let step = to;
  while (step !== from) {
    route.unshift(step);
    step = prev.get(step)!;
  }
  return route;
}

/** NPC daimyo that hold land when the world is created (AI-01). */
export interface NpcClanDef {
  key: string;
  name: string;
  daimyoName: string;
  bannerColor: string;
  bannerMon: string;
  portrait: string;
  personality: 'defensive' | 'aggressive';
  capital: string;
  pillarLevel: number;
  garrison: Partial<UnitCounts>;
  description: string;
}

export const NPC_CLANS: NpcClanDef[] = [
  {
    key: 'rokkaku',
    name: 'Rokkaku',
    daimyoName: 'Rokkaku Yoshikata',
    bannerColor: 'pine',
    bannerMon: 'diamonds',
    portrait: 'steward',
    personality: 'defensive',
    capital: 'omi',
    pillarLevel: 3,
    garrison: { ashigaru: 180, yari: 80, archer: 60, samurai: 20 },
    description: 'Old constables of Omi. Patient builders who strike only when the odds are certain.',
  },
  {
    key: 'miyoshi',
    name: 'Miyoshi',
    daimyoName: 'Miyoshi Nagayoshi',
    bannerColor: 'indigo',
    bannerMon: 'bars',
    portrait: 'general',
    personality: 'aggressive',
    capital: 'settsu',
    pillarLevel: 3,
    garrison: { ashigaru: 200, yari: 60, archer: 50, samurai: 30 },
    description: 'Ambitious lords of the inner sea, always reaching for the capital.',
  },
];
