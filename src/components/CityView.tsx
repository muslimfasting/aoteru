/**
 * The castle town of a province, drawn as an ink-and-wash print.
 *
 * Purely presentational: every element is derived from the building levels the
 * server reports, so the town visibly grows as the player builds — more tiers
 * on the keep, more paddies, a longer shop street — and picks up the trappings
 * of a land rebuilding itself at a Meiji-era level: brick trading houses, gas
 * lamps, telegraph lines, a factory chimney.
 */
import type { ReactNode } from 'react';
import { BUILDINGS, type BuildingLevels, type BuildingType, type Terrain } from '@/game/config';
import { Icon } from './icons';

const INK = '#221c15';
const PAPER = '#efe3c6';
const RED = '#9b2d30';
const GOLD = '#c8a24a';
const ROOF = '#2e2a26';
const WALL = '#f4ecd9';
const WOOD = '#8a6a48';
const WOOD_D = '#654b32';
const BRICK = '#9a5443';
const BRICK_D = '#7a3f33';
const STONE = '#8f8672';
const GROUND = '#d7c391';
const GROUND_D = '#c2ab76';
const GREEN = '#5d7a4a';
const PINE = '#34503c';
const WATER = '#a3c0b0';
const SEA = '#557a88';
const LIGHT = '#f6d27a';

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const pts = (list: number[][]) => list.map((p) => p.join(',')).join(' ');

export interface CityViewProps {
  name: string;
  kanji: string;
  terrain: Terrain;
  levels: BuildingLevels;
  /** Building currently under construction, if any. */
  upgrading: BuildingType | null;
  /** Clan colour (hex) for the banners. */
  bannerHex: string;
  /** Game hour 0-23: the print shifts between day, dusk and night. */
  hour: number;
  className?: string;
}

/** What the next levels will add to the picture, so the print doubles as a goal list. */
const LANDMARKS: { type: BuildingType; level: number; text: string }[] = [
  { type: 'barracks', level: 1, text: 'a drill hall behind a palisade' },
  { type: 'market', level: 1, text: 'the first shops along the castle road' },
  { type: 'castle', level: 2, text: 'a second tier on the keep and your banners' },
  { type: 'barracks', level: 2, text: 'an archery range' },
  { type: 'dojo', level: 1, text: 'a training hall and its gate' },
  { type: 'farm', level: 3, text: 'a white-walled storehouse' },
  { type: 'castle', level: 3, text: 'walls and a gatehouse' },
  { type: 'market', level: 3, text: 'a brick trading house' },
  { type: 'dojo', level: 2, text: 'stables for the cavalry' },
  { type: 'barracks', level: 4, text: 'a brick armoury' },
  { type: 'castle', level: 4, text: 'a fourth tier on the keep' },
  { type: 'market', level: 5, text: 'a clock tower' },
  { type: 'castle', level: 5, text: 'the full five-tiered keep' },
  { type: 'farm', level: 6, text: 'a water wheel' },
  { type: 'castle', level: 6, text: 'corner turrets' },
  { type: 'barracks', level: 6, text: 'a watchtower' },
  { type: 'castle', level: 8, text: 'a moat' },
];

function Tag({ x, y, type, level, building }: { x: number; y: number; type: BuildingType; level: number; building: boolean }) {
  const label = `${BUILDINGS[type].name} ${level > 0 ? level : '—'}`;
  const width = 34 + label.length * 6.6;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={0} y={0} width={width} height={22} rx={3} fill={PAPER} stroke={INK} strokeWidth={1} opacity={0.95} />
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

function Scaffold({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const lines: ReactNode[] = [];
  for (let i = 0; i <= 5; i++) lines.push(<line key={`v${i}`} x1={x + (w * i) / 5} y1={y} x2={x + (w * i) / 5} y2={y + h} />);
  for (let j = 0; j <= 3; j++) lines.push(<line key={`h${j}`} x1={x - 4} y1={y + (h * j) / 3} x2={x + w + 4} y2={y + (h * j) / 3} />);
  return (
    <g stroke="#b8893d" strokeWidth={1.6} opacity={0.9} strokeLinecap="round">
      {lines}
      <line x1={x} y1={y + h} x2={x + w} y2={y} strokeWidth={1} />
    </g>
  );
}

function Lot({ x, y, w, h, label }: { x: number; y: number; w: number; h: number; label: string }) {
  return (
    <g opacity={0.55}>
      <rect x={x} y={y} width={w} height={h} rx={4} fill="none" stroke={INK} strokeWidth={1.2} strokeDasharray="5 5" />
      <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" fontSize={11} fill={INK} fontStyle="italic">
        {label}
      </text>
    </g>
  );
}

function Pine({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M0 0 C-4 -30 6 -52 -2 -86" stroke={WOOD_D} strokeWidth={6} fill="none" strokeLinecap="round" />
      <path d="M-2 -50 C-16 -56 -22 -62 -34 -60" stroke={WOOD_D} strokeWidth={3} fill="none" strokeLinecap="round" />
      {[
        [-36, -66, 30, 9],
        [18, -74, 34, 10],
        [-8, -94, 38, 11],
        [-22, -112, 24, 8],
        [14, -116, 22, 7],
      ].map(([cx, cy, rx, ry], i) => (
        <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} fill={PINE} stroke={INK} strokeWidth={1} />
      ))}
    </g>
  );
}

function Lamp({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={y - 26} stroke={INK} strokeWidth={2} />
      <path d={`M${x - 5} ${y - 26} h10 l-2 -9 h-6 z`} fill={ROOF} />
      <rect x={x - 3} y={y - 34} width={6} height={7} fill={LIGHT} stroke={INK} strokeWidth={0.8} />
    </g>
  );
}

export function CityView({ name, kanji, terrain, levels, upgrading, bannerHex, hour, className }: CityViewProps) {
  const night = hour >= 19 || hour < 5;
  const dusk = !night && (hour < 7 || hour >= 17);
  const development = levels.castle + levels.farm + levels.market + levels.barracks + levels.dojo;
  const id = `city-${kanji}`;

  // ------------------------------------------------------------------ keep
  const tiers = clamp(levels.castle, 1, 5);
  const keep: ReactNode[] = [];
  const keepLights: ReactNode[] = [];
  let top = 214;
  for (let i = 0; i < tiers; i++) {
    const w = 108 - i * 17;
    const x = 480 - w / 2;
    const bodyTop = top - 22;
    const last = i === tiers - 1;
    keep.push(
      <g key={`tier${i}`}>
        <rect x={x} y={bodyTop} width={w} height={22} fill={WALL} stroke={INK} strokeWidth={1.2} />
        <rect x={x} y={bodyTop + 15} width={w} height={7} fill="#3a342c" opacity={0.85} />
        {Array.from({ length: Math.max(2, 4 - i) }, (_, k) => {
          const n = Math.max(2, 4 - i);
          const wx = x + (w / (n + 1)) * (k + 1) - 3;
          keepLights.push(<rect key={`l${i}-${k}`} x={wx} y={bodyTop + 4} width={6} height={8} fill={LIGHT} />);
          return <rect key={k} x={wx} y={bodyTop + 4} width={6} height={8} fill={INK} />;
        })}
        {last ? (
          <>
            <path d={`M${x - 16} ${bodyTop + 1} Q${x - 4} ${bodyTop - 6} 480 ${bodyTop - 30} Q${x + w + 4} ${bodyTop - 6} ${x + w + 16} ${bodyTop + 1} Z`} fill={ROOF} stroke={INK} strokeWidth={1} />
            <path d={`M${x - 16} ${bodyTop + 1} l-7 -6`} stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
            <path d={`M${x + w + 16} ${bodyTop + 1} l7 -6`} stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
            <path d={`M474 ${bodyTop - 28} q-3 -9 5 -12`} stroke={GOLD} strokeWidth={2.4} fill="none" strokeLinecap="round" />
            <path d={`M486 ${bodyTop - 28} q3 -9 -5 -12`} stroke={GOLD} strokeWidth={2.4} fill="none" strokeLinecap="round" />
          </>
        ) : (
          <>
            <path d={`M${x - 14} ${bodyTop + 1} L${x + 8} ${bodyTop - 9} H${x + w - 8} L${x + w + 14} ${bodyTop + 1} Z`} fill={ROOF} stroke={INK} strokeWidth={1} />
            <path d={`M${x - 14} ${bodyTop + 1} l-7 -6`} stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
            <path d={`M${x + w + 14} ${bodyTop + 1} l7 -6`} stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
          </>
        )}
      </g>,
    );
    top = bodyTop - 9;
  }
  const keepTop = top - 22;

  // --------------------------------------------------------------- paddies
  const plots = clamp(levels.farm * 2, 0, 8);
  const paddies = Array.from({ length: plots }, (_, k) => {
    const col = k % 4;
    const row = Math.floor(k / 4);
    const x0 = 196 + col * 50 - row * 16;
    const y0 = 306 + row * 40;
    return (
      <g key={k}>
        <polygon points={pts([[x0, y0], [x0 + 44, y0], [x0 + 37, y0 + 32], [x0 - 7, y0 + 32]])} fill={WATER} stroke={INK} strokeWidth={1} />
        {[8, 16, 24].map((dy) => (
          <line key={dy} x1={x0 - dy * 0.2 + 5} y1={y0 + dy} x2={x0 - dy * 0.2 + 39} y2={y0 + dy} stroke={GREEN} strokeWidth={2.2} strokeDasharray="2 4" strokeLinecap="round" />
        ))}
      </g>
    );
  });

  // ----------------------------------------------------------------- shops
  const shops = clamp(levels.market, 0, 5);
  const norens = [RED, '#31487a', '#b8862f', '#2f6b4f', RED];
  const shopRow = Array.from({ length: shops }, (_, i) => {
    const x = 566 + i * 44;
    return (
      <g key={i}>
        <rect x={x} y={312} width={38} height={24} fill={WOOD} stroke={INK} strokeWidth={1} />
        <path d={`M${x - 5} 313 L${x + 5} 300 H${x + 33} L${x + 43} 313 Z`} fill={ROOF} stroke={INK} strokeWidth={1} />
        <rect x={x + 4} y={315} width={30} height={9} fill={norens[i]} />
        <circle cx={x + 19} cy={319.5} r={2.6} fill={PAPER} />
        <rect x={x + 5} y={326} width={28} height={10} fill={WOOD_D} />
      </g>
    );
  });

  // ---------------------------------------------------------------- terrain
  let backdrop: ReactNode;
  if (terrain === 'mountains') {
    backdrop = (
      <>
        <polygon points="0,236 90,150 160,204 250,104 340,192 430,146 520,208 640,116 730,194 830,138 960,220 960,270 0,270" fill={INK} opacity={0.16} />
        <polygon points="238,122 250,104 262,122 254,118 248,124" fill={WALL} opacity={0.9} />
        <polygon points="628,134 640,116 652,134 644,129 637,136" fill={WALL} opacity={0.9} />
        <polygon points="0,256 120,192 210,238 330,176 430,244 560,190 690,242 800,184 960,248 960,276 0,276" fill={INK} opacity={0.24} />
      </>
    );
  } else if (terrain === 'hills') {
    backdrop = (
      <>
        <ellipse cx={170} cy={272} rx={250} ry={78} fill={INK} opacity={0.14} />
        <ellipse cx={560} cy={280} rx={280} ry={70} fill={INK} opacity={0.17} />
        <ellipse cx={860} cy={274} rx={210} ry={84} fill={INK} opacity={0.14} />
        {[70, 150, 250, 640, 760, 880].map((x, i) => (
          <circle key={x} cx={x} cy={214 + (i % 3) * 8} r={9} fill={PINE} opacity={0.5} />
        ))}
      </>
    );
  } else if (terrain === 'coast') {
    backdrop = (
      <>
        <rect x={0} y={206} width={960} height={50} fill={SEA} opacity={0.75} />
        {[40, 170, 300, 660, 790, 900].map((x, i) => (
          <path key={x} d={`M${x} ${222 + (i % 2) * 12} q10 -7 20 0 t20 0`} stroke={PAPER} strokeWidth={1.4} fill="none" opacity={0.7} />
        ))}
        <path d="M120 228 l0 -34 l20 30 z" fill={WALL} stroke={INK} strokeWidth={1} />
        <path d="M108 230 h34 l-5 8 h-24 z" fill={WOOD_D} stroke={INK} strokeWidth={1} />
        <ellipse cx={850} cy={250} rx={170} ry={46} fill={INK} opacity={0.2} />
      </>
    );
  } else {
    backdrop = (
      <>
        <ellipse cx={300} cy={262} rx={360} ry={34} fill={INK} opacity={0.12} />
        <ellipse cx={780} cy={258} rx={300} ry={30} fill={INK} opacity={0.12} />
        {[60, 130, 820, 890].map((x) => (
          <rect key={x} x={x} y={232} width={46} height={10} fill={GREEN} opacity={0.35} transform={`skewX(-18)`} />
        ))}
      </>
    );
  }

  const scaffolds: Record<BuildingType, [number, number, number, number]> = {
    castle: [408, keepTop - 6, 144, 250 - keepTop],
    farm: [176, 262, 216, 124],
    market: [560, 292, 244, 50],
    barracks: [188, 214, 176, 46],
    dojo: [590, 204, 168, 54],
  };
  const next = LANDMARKS.filter((m) => levels[m.type] < m.level).slice(0, 2);
  const lamps = clamp(Math.ceil(levels.market / 2), 0, 4);
  const lampSpots = [
    [528, 350],
    [436, 350],
    [520, 296],
    [446, 296],
  ];

  return (
    <figure className={className}>
      <div className="paper overflow-hidden rounded-[3px] border border-gold/40 p-0">
        <svg
          viewBox="0 0 960 400"
          preserveAspectRatio="xMidYMid slice"
          role="img"
          aria-label={`The castle town of ${name}: castle level ${levels.castle}, farm ${levels.farm}, market ${levels.market}, barracks ${levels.barracks}, dojo ${levels.dojo}.`}
          className="block aspect-[16/10] w-full sm:aspect-[12/5]"
        >
          <defs>
            <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={night ? '#1b2233' : dusk ? '#e9b98a' : '#f3e9cf'} />
              <stop offset="1" stopColor={night ? '#39405a' : dusk ? '#f0dcb0' : '#e6d6ae'} />
            </linearGradient>
            <linearGradient id={`${id}-stone`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#a39a84" />
              <stop offset="1" stopColor={STONE} />
            </linearGradient>
            <radialGradient id={`${id}-glow`}>
              <stop offset="0" stopColor={LIGHT} stopOpacity="0.75" />
              <stop offset="1" stopColor={LIGHT} stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* sky, sun or moon, mist bands */}
          <rect width={960} height={400} fill={`url(#${id}-sky)`} />
          {night ? (
            <>
              <circle cx={764} cy={78} r={24} fill="#efe6cc" />
              <circle cx={774} cy={72} r={22} fill="#1f2638" />
              {[[120, 60], [220, 34], [350, 80], [560, 44], [640, 96], [880, 52], [60, 130]].map(([x, y]) => (
                <circle key={`${x}-${y}`} cx={x} cy={y} r={1.4} fill="#efe6cc" />
              ))}
            </>
          ) : (
            <circle cx={764} cy={dusk ? 150 : 84} r={36} fill={RED} opacity={dusk ? 0.9 : 0.82} />
          )}
          {[[90, 96, 210], [610, 58, 170], [330, 138, 150], [700, 170, 190]].map(([x, y, w]) => (
            <rect key={`${x}-${y}`} x={x} y={y} width={w} height={13} rx={6.5} fill={night ? '#4a516b' : '#fbf4e0'} opacity={night ? 0.5 : 0.75} />
          ))}

          {backdrop}

          {/* ground */}
          <path d="M0 252 Q240 226 480 240 T960 246 V400 H0 Z" fill={GROUND} />
          <path d="M0 330 Q260 300 480 318 T960 322 V400 H0 Z" fill={GROUND_D} opacity={0.55} />
          {[[70, 300], [130, 368], [860, 300], [910, 366], [420, 384], [640, 372]].map(([x, y]) => (
            <path key={`${x}-${y}`} d={`M${x} ${y} q4 -9 8 0 M${x + 9} ${y + 1} q4 -8 8 0`} stroke={GREEN} strokeWidth={1.6} fill="none" opacity={0.7} />
          ))}

          {/* Meiji-era works that come with a developed town */}
          {development >= 5 ? (
            <g stroke={INK} strokeWidth={1.4} fill="none" opacity={0.75}>
              {[40, 130, 220, 310].map((x, i) => (
                <g key={x}>
                  <line x1={x} y1={258 - i * 4} x2={x} y2={206 - i * 4} strokeWidth={2.2} />
                  <line x1={x - 9} y1={212 - i * 4} x2={x + 9} y2={212 - i * 4} />
                  <line x1={x - 7} y1={219 - i * 4} x2={x + 7} y2={219 - i * 4} />
                </g>
              ))}
              <path d="M40 212 Q85 224 130 208 Q175 220 220 204 Q265 216 310 200" strokeWidth={0.9} />
              <path d="M40 219 Q85 231 130 215 Q175 227 220 211 Q265 223 310 207" strokeWidth={0.9} />
            </g>
          ) : null}
          {development >= 8 ? (
            <g>
              <rect x={842} y={212} width={46} height={30} fill={BRICK} stroke={INK} strokeWidth={1} />
              <path d="M836 213 l8 -8 h42 l8 8 z" fill={ROOF} />
              <path d="M866 205 l3 -62 h10 l3 62 z" fill={BRICK_D} stroke={INK} strokeWidth={1} />
              <rect x={867} y={141} width={14} height={5} fill={ROOF} />
              <path d="M874 138 q-14 -10 -4 -22 q10 -10 -6 -22 q-10 -10 4 -20" stroke={INK} strokeWidth={5} fill="none" opacity={0.18} strokeLinecap="round" />
            </g>
          ) : null}

          {/* castle mound, stone base, keep */}
          <ellipse cx={480} cy={254} rx={156} ry={24} fill={GROUND_D} />
          {levels.castle >= 8 ? <path d="M330 262 Q480 290 630 262" stroke={SEA} strokeWidth={10} fill="none" opacity={0.75} strokeLinecap="round" /> : null}
          <polygon points="408,250 552,250 538,214 422,214" fill={`url(#${id}-stone)`} stroke={INK} strokeWidth={1.2} />
          <path d="M416 238 H544 M420 226 H540 M440 214 l-6 36 M470 214 l-3 36 M500 214 l3 36 M526 214 l8 36" stroke={INK} strokeWidth={0.7} opacity={0.55} />
          {keep}
          {levels.castle >= 2 ? (
            <g>
              {[394, 566].map((x) => (
                <g key={x}>
                  <line x1={x} y1={250} x2={x} y2={176} stroke={INK} strokeWidth={1.6} />
                  <rect x={x + 1} y={178} width={12} height={44} fill={bannerHex} stroke={INK} strokeWidth={0.8} />
                  <circle cx={x + 7} cy={190} r={3.2} fill={PAPER} />
                </g>
              ))}
            </g>
          ) : null}
          {levels.castle >= 3 ? (
            <g>
              <rect x={352} y={244} width={256} height={13} fill={WALL} stroke={INK} strokeWidth={1} />
              <rect x={348} y={240} width={264} height={5} fill={ROOF} />
              <rect x={466} y={236} width={28} height={21} fill={WOOD_D} stroke={INK} strokeWidth={1} />
              <path d="M458 237 l8 -8 h28 l8 8 z" fill={ROOF} />
            </g>
          ) : null}
          {levels.castle >= 6
            ? [352, 596].map((x) => (
                <g key={x}>
                  <rect x={x - 12} y={222} width={24} height={22} fill={WALL} stroke={INK} strokeWidth={1} />
                  <path d={`M${x - 19} 223 l9 -10 h20 l9 10 z`} fill={ROOF} stroke={INK} strokeWidth={0.8} />
                  <rect x={x - 3} y={228} width={6} height={7} fill={INK} />
                </g>
              ))
            : null}

          {/* road from the gate through the town */}
          <polygon points="446,400 514,400 492,258 468,258" fill="#cbb684" stroke={INK} strokeWidth={0.8} opacity={0.95} />
          <path d="M480 262 V396" stroke={INK} strokeWidth={0.8} strokeDasharray="3 9" opacity={0.4} />

          {/* barracks */}
          {levels.barracks > 0 ? (
            <g>
              {levels.barracks >= 4 ? (
                <g>
                  <rect x={190} y={228} width={34} height={28} fill={BRICK} stroke={INK} strokeWidth={1} />
                  <path d="M186 229 l6 -8 h30 l6 8 z" fill={ROOF} />
                  <path d="M201 256 v-11 a6 6 0 0 1 12 0 v11 z" fill={INK} />
                </g>
              ) : null}
              <rect x={230} y={234} width={112} height={20} fill={WOOD} stroke={INK} strokeWidth={1} />
              <path d="M222 235 L236 220 H336 L350 235 Z" fill={ROOF} stroke={INK} strokeWidth={1} />
              {[244, 270, 296, 322].map((x) => (
                <rect key={x} x={x} y={240} width={9} height={8} fill={INK} />
              ))}
              <path d="M196 258 H366" stroke={WOOD_D} strokeWidth={1.6} />
              {Array.from({ length: 18 }, (_, i) => (
                <path key={i} d={`M${198 + i * 10} 262 v-9 l3 -3 l3 3 v9`} fill={WOOD} stroke={INK} strokeWidth={0.6} />
              ))}
              <line x1={346} y1={234} x2={346} y2={204} stroke={INK} strokeWidth={1.4} />
              <path d="M347 205 h16 l-5 5 l5 5 h-16 z" fill={RED} />
              {levels.barracks >= 2 ? (
                <g>
                  <circle cx={372} cy={246} r={7} fill={PAPER} stroke={INK} strokeWidth={1} />
                  <circle cx={372} cy={246} r={4} fill="none" stroke={INK} strokeWidth={1} />
                  <circle cx={372} cy={246} r={1.6} fill={RED} />
                  <line x1={372} y1={253} x2={372} y2={260} stroke={INK} strokeWidth={1.4} />
                </g>
              ) : null}
              {levels.barracks >= 6 ? (
                <g>
                  <path d="M206 228 l4 -44 M226 228 l-4 -44 M208 208 h16 M207 218 h18" stroke={WOOD_D} strokeWidth={2} fill="none" />
                  <rect x={204} y={172} width={24} height={12} fill={WOOD} stroke={INK} strokeWidth={1} />
                  <path d="M200 173 l16 -11 l16 11 z" fill={ROOF} />
                </g>
              ) : null}
            </g>
          ) : (
            <Lot x={206} y={222} w={150} h={34} label="ground for a barracks" />
          )}

          {/* dojo */}
          {levels.dojo > 0 ? (
            <g>
              <rect x={612} y={232} width={86} height={22} fill={WALL} stroke={INK} strokeWidth={1} />
              {[624, 640, 656, 672, 688].map((x) => (
                <line key={x} x1={x} y1={233} x2={x} y2={254} stroke={WOOD_D} strokeWidth={1.6} />
              ))}
              <path d="M594 234 Q655 196 716 234 l8 -5 l-3 9 H589 l-3 -9 z" fill={ROOF} stroke={INK} strokeWidth={1} />
              <path d="M736 256 v-26 M758 256 v-26 M730 232 h34 M733 238 h28" stroke={RED} strokeWidth={3} fill="none" strokeLinecap="round" />
              {levels.dojo >= 2 ? (
                <g>
                  <rect x={704} y={240} width={24} height={14} fill={WOOD} stroke={INK} strokeWidth={1} />
                  <path d="M700 241 l6 -7 h20 l6 7 z" fill={ROOF} />
                  <g fill={INK}>
                    <ellipse cx={782} cy={246} rx={11} ry={5} />
                    <path d="M790 244 l7 -10 l4 2 l-5 10 z" />
                    <path d="M774 250 v9 M779 250 v9 M786 250 v9 M790 250 v9" stroke={INK} strokeWidth={1.6} />
                    <path d="M771 245 q-5 4 -4 10" stroke={INK} strokeWidth={1.4} fill="none" />
                  </g>
                </g>
              ) : null}
              {levels.dojo >= 4
                ? [600, 616, 632].map((x) => <path key={x} d={`M${x} 272 v-13 M${x - 6} 263 h12`} stroke={WOOD_D} strokeWidth={2.4} strokeLinecap="round" />)
                : null}
            </g>
          ) : (
            <Lot x={604} y={220} w={140} h={36} label="ground for a dojo" />
          )}

          {/* farm */}
          {levels.farm > 0 ? (
            <g>
              <rect x={202} y={276} width={40} height={18} fill={WALL} stroke={INK} strokeWidth={1} />
              <path d="M194 278 Q222 248 250 278 Z" fill="#b89a5a" stroke={INK} strokeWidth={1} />
              <rect x={216} y={283} width={9} height={11} fill={INK} />
              {levels.farm >= 3 ? (
                <g>
                  <rect x={256} y={272} width={26} height={22} fill={WALL} stroke={INK} strokeWidth={1} />
                  <rect x={256} y={286} width={26} height={8} fill="#3a342c" />
                  <path d="M251 273 l7 -9 h22 l7 9 z" fill={ROOF} />
                  <rect x={265} y={277} width={7} height={6} fill={INK} />
                </g>
              ) : null}
              {levels.farm >= 6 ? (
                <g stroke={WOOD_D} fill="none">
                  <circle cx={176} cy={300} r={15} strokeWidth={3} />
                  <path d="M176 285 v30 M161 300 h30 M165.5 289.5 l21 21 M186.5 289.5 l-21 21" strokeWidth={1.4} />
                  <path d="M160 316 q16 6 34 0" stroke={SEA} strokeWidth={3} />
                </g>
              ) : null}
              {paddies}
            </g>
          ) : (
            <Lot x={186} y={300} w={200} h={70} label="fallow fields" />
          )}

          {/* market street */}
          {levels.market > 0 ? (
            <g>
              {levels.market >= 3 ? (
                <g>
                  <rect x={752} y={282} width={46} height={54} fill={BRICK} stroke={INK} strokeWidth={1} />
                  <path d="M752 300 h46 M752 318 h46" stroke={BRICK_D} strokeWidth={1} />
                  <rect x={748} y={278} width={54} height={6} fill={WALL} stroke={INK} strokeWidth={0.8} />
                  {[759, 771, 783].map((x) => (
                    <path key={x} d={`M${x} 302 v-8 a4 4 0 0 1 8 0 v8 z`} fill={INK} />
                  ))}
                  <path d="M769 336 v-12 a6 6 0 0 1 12 0 v12 z" fill={WOOD_D} stroke={INK} strokeWidth={0.8} />
                  {levels.market >= 5 ? (
                    <g>
                      <rect x={766} y={248} width={18} height={30} fill={BRICK_D} stroke={INK} strokeWidth={1} />
                      <circle cx={775} cy={260} r={6} fill={PAPER} stroke={INK} strokeWidth={1} />
                      <path d="M775 260 v-4 M775 260 h3" stroke={INK} strokeWidth={1} />
                      <path d="M763 249 l12 -13 l12 13 z" fill={ROOF} />
                    </g>
                  ) : null}
                </g>
              ) : null}
              {shopRow}
            </g>
          ) : (
            <Lot x={566} y={300} w={210} h={40} label="an empty market street" />
          )}
          {lampSpots.slice(0, lamps).map(([x, y]) => (
            <Lamp key={`${x}-${y}`} x={x} y={y} />
          ))}

          {/* foreground pines frame the print */}
          <Pine x={96} y={396} s={1.25} />
          <Pine x={874} y={398} s={1.1} />
          <Pine x={30} y={300} s={0.6} />

          {upgrading ? <Scaffold x={scaffolds[upgrading][0]} y={scaffolds[upgrading][1]} w={scaffolds[upgrading][2]} h={scaffolds[upgrading][3]} /> : null}

          {/* evening and night washes; lights are drawn above them */}
          {dusk ? <rect width={960} height={400} fill="#b5562f" opacity={0.16} /> : null}
          {night ? (
            <>
              <rect width={960} height={400} fill="#101728" opacity={0.56} />
              {keepLights}
              {levels.market > 0
                ? Array.from({ length: shops }, (_, i) => <rect key={i} x={571 + i * 44} y={326} width={28} height={10} fill={LIGHT} opacity={0.9} />)
                : null}
              {levels.barracks > 0 ? [244, 296].map((x) => <rect key={x} x={x} y={240} width={9} height={8} fill={LIGHT} />) : null}
              {levels.farm > 0 ? <rect x={216} y={283} width={9} height={11} fill={LIGHT} /> : null}
              {lampSpots.slice(0, lamps).map(([x, y]) => (
                <g key={`g${x}-${y}`}>
                  <circle cx={x} cy={y - 30} r={24} fill={`url(#${id}-glow)`} />
                  <rect x={x - 3} y={y - 34} width={6} height={7} fill={LIGHT} />
                </g>
              ))}
            </>
          ) : null}

          {/* title cartouche and level tags */}
          <g>
            <rect x={196} y={22} width={40} height={kanji.length > 1 ? 86 : 50} fill={RED} stroke={INK} strokeWidth={1.2} />
            <rect x={199} y={25} width={34} height={kanji.length > 1 ? 80 : 44} fill="none" stroke={PAPER} strokeWidth={0.8} opacity={0.7} />
            {Array.from(kanji).slice(0, 2).map((ch, i) => (
              <text key={i} x={216} y={58 + i * 36} textAnchor="middle" fontSize={30} fontWeight={800} fill={PAPER} className="font-display">
                {ch}
              </text>
            ))}
          </g>
          <Tag x={560} y={clamp(keepTop + 6, 30, 170)} type="castle" level={levels.castle} building={upgrading === 'castle'} />
          <Tag x={300} y={196} type="barracks" level={levels.barracks} building={upgrading === 'barracks'} />
          <Tag x={640} y={184} type="dojo" level={levels.dojo} building={upgrading === 'dojo'} />
          <Tag x={300} y={276} type="farm" level={levels.farm} building={upgrading === 'farm'} />
          <Tag x={640} y={346} type="market" level={levels.market} building={upgrading === 'market'} />

          <rect x={6} y={6} width={948} height={388} fill="none" stroke={INK} strokeWidth={1.2} opacity={0.55} />
        </svg>
      </div>
      <figcaption className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          <span className="font-display text-sm font-bold text-parchment">{name}</span> as it stands
          {night ? ', by night' : dusk ? ', in the low sun' : ''}. Everything you build appears here.
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
