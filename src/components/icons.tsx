/**
 * Pictogram icons. Each one is a plain line drawing of the thing it stands for
 * (a coin for gold, a rice bowl for food, crossed swords for the army), so the
 * interface can be read without knowing any kanji. They inherit the text colour
 * and scale with the font size of their container.
 */
import type { ReactNode } from 'react';

const coin = (
  <>
    <circle cx="12" cy="12" r="8.5" />
    <rect x="9.5" y="9.5" width="5" height="5" />
  </>
);
const swords = (
  <>
    <path d="M4 4l11 11" />
    <path d="M13.5 17.5l4-4" />
    <path d="M16 16l4 4" />
    <path d="M20 4L9 15" />
    <path d="M6.5 13.5l4 4" />
    <path d="M8 16l-4 4" />
  </>
);
const eye = (
  <>
    <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>
);
const keep = (
  <>
    <path d="M3 21h18" />
    <path d="M6 21v-6h12v6" />
    <path d="M4 15l2.5-3h11L20 15z" />
    <path d="M8.5 12V9h7v3" />
    <path d="M7 9l1.8-2.5h6.4L17 9z" />
    <path d="M12 6.5V3.5" />
  </>
);

const PATHS = {
  // resources
  gold: coin,
  food: (
    <>
      <path d="M4 12h16a8 8 0 0 1-16 0z" />
      <path d="M7 12a5 4.5 0 0 1 10 0" />
      <path d="M9 20.5h6" />
    </>
  ),
  wood: (
    <>
      <ellipse cx="6.5" cy="15" rx="3" ry="4" />
      <path d="M6.5 11H18a3 4 0 0 1 0 8H6.5" />
      <path d="M11 14.5h5" />
    </>
  ),
  stone: (
    <>
      <path d="M3 19l4.5-8.5L12 13l3.5-6.5L21 19z" />
      <path d="M9 19l2-3.5" />
    </>
  ),
  iron: (
    <>
      <path d="M3 8h14v2.5a4.5 4.5 0 0 1-4.5 4.5H12v3h4v2H7v-2h3v-3H8.5A5.5 5.5 0 0 1 3 9.5z" />
      <path d="M17 9h4" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M16 14.5a5 5 0 0 1 5.5 5.5" />
    </>
  ),
  army: swords,
  // navigation
  overview: (
    <>
      <path d="M3 11.5L12 4l9 7.5" />
      <path d="M5.5 10v10h13V10" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  map: (
    <>
      <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
      <path d="M9 4v14M15 6v14" />
    </>
  ),
  castle: keep,
  military: swords,
  pillars: (
    <>
      <path d="M3 9l9-5 9 5z" />
      <path d="M5 9v9M9.7 9v9M14.3 9v9M19 9v9" />
      <path d="M3 20h18" />
    </>
  ),
  diplomacy: (
    <>
      <path d="M6 4h11a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2z" />
      <path d="M10 9h5M10 13h5" />
      <circle cx="16.5" cy="17" r="1.6" />
    </>
  ),
  intel: eye,
  ranking: (
    <>
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" />
      <path d="M12 14v4M8.5 20.5h7" />
    </>
  ),
  messages: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="1.5" />
      <path d="M3.5 7l8.5 6.5L20.5 7" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </>
  ),
  // buildings
  farm: (
    <>
      <path d="M12 21V9" />
      <path d="M12 13c-4 0-6-2.5-6-6 4 0 6 2.5 6 6z" />
      <path d="M12 11c4 0 6-2.5 6-6-4 0-6 2.5-6 6z" />
      <path d="M5 21h14" />
    </>
  ),
  market: (
    <>
      <path d="M3 9l2-5h14l2 5" />
      <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
      <path d="M5 12v8h14v-8" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  barracks: (
    <>
      <path d="M3 20L12 7l9 13z" />
      <path d="M12 20v-6" />
      <path d="M12 7V2.5h4.5L15 4l1.5 1.5H12" />
    </>
  ),
  dojo: (
    <>
      <path d="M3 6.5c3 1 15 1 18 0" />
      <path d="M5 10h14" />
      <path d="M7 7v14M17 7v14" />
    </>
  ),
  // units
  ashigaru: (
    <>
      <path d="M3 15l9-9 9 9z" />
      <path d="M2 15h20" />
      <path d="M8.5 15v2a3.5 3.5 0 0 0 7 0v-2" />
    </>
  ),
  yari: (
    <>
      <path d="M4 20L16 8" />
      <path d="M16 8l1-5 3 3-5 1z" />
      <path d="M7 14l3 3" />
    </>
  ),
  archer: (
    <>
      <path d="M6 3c8 3 8 15 0 18" />
      <path d="M6 3v18" />
      <path d="M3 12h17" />
      <path d="M17 9l3 3-3 3" />
    </>
  ),
  samurai: (
    <>
      <path d="M5 13a7 7 0 0 1 14 0v2H5z" />
      <path d="M3 15h18l-2 4H5z" />
      <path d="M9 6.5L7 2.5M15 6.5l2-4" />
    </>
  ),
  cavalry: (
    <>
      <path d="M7 21c0-5 1-8 4-10l-1-3 3-4 2 3c3 1 5 4 5 7l-3 2-3-2-2 2v5" />
      <path d="M15 9.4v.2" />
    </>
  ),
  // pillars
  leadership: (
    <>
      <path d="M6 21V3" />
      <path d="M6 4h11l-2.5 4L17 12H6" />
    </>
  ),
  economy: coin,
  intelligence: eye,
  culture: (
    <>
      <path d="M3 5c3-1 6-1 9 1v14c-3-2-6-2-9-1z" />
      <path d="M21 5c-3-1-6-1-9 1v14c3-2 6-2 9-1z" />
    </>
  ),
  // status and section icons
  alert: (
    <>
      <path d="M12 3.5l9.5 16.5h-19z" />
      <path d="M12 10v4.5M12 17.2v.3" />
    </>
  ),
  shield: <path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z" />,
  province: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2.3" />
    </>
  ),
  scroll: (
    <>
      <path d="M7 4h11v13a3 3 0 0 1-3 3H6a3 3 0 0 0 3-3V6a2 2 0 0 0-4 0v2h4" />
      <path d="M12 9h3M12 13h3" />
    </>
  ),
  history: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  build: (
    <>
      <path d="M14 5l5 5-2.5 2.5-5-5z" />
      <path d="M12.5 8.5L4 17l3 3 8.5-8.5" />
    </>
  ),
  chat: <path d="M4 5h16v11h-9l-5 4v-4H4z" />,
  cross: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M4.5 12.5l5 5 10-11" />,
  quake: <path d="M2 13h4l2-6 3.5 11 3-9 2 4H22" />,
  fire: (
    <>
      <path d="M12 3c1 4 5 5.5 5 10.5a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 .5-3-.5-6 1-9z" />
    </>
  ),
  crown: (
    <>
      <path d="M4 18l-1-10 5 4 4-7 4 7 5-4-1 10z" />
      <path d="M4 21h16" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c3 3 3 14 0 17M12 3.5c-3 3-3 14 0 17" />
    </>
  ),
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />,
  compass: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </>
  ),
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  dot: <circle cx="12" cy="12" r="3" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = '1.2em',
  x,
  y,
  className,
  strokeWidth = 1.8,
}: {
  name: IconName;
  size?: number | string;
  /** Position, when the icon is placed inside another SVG. */
  x?: number;
  y?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      x={x}
      y={y}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      style={{ flex: 'none' }}
    >
      {PATHS[name]}
    </svg>
  );
}

/**
 * Section and status markers are keyed by short codes in the screens (a legacy
 * of the first design, which printed the codes themselves as seals). This table
 * turns each code into a pictogram, so no screen ever shows the code.
 */
const CODE_ICON: Record<string, IconName> = {
  '戦': 'military',
  '報': 'messages',
  '兵': 'army',
  '忍': 'intel',
  '軍': 'military',
  '進': 'leadership',
  '攻': 'military',
  '和': 'diplomacy',
  '天下統一': 'castle',
  '城': 'castle',
  '敵': 'alert',
  '飢': 'food',
  '国': 'province',
  '柱': 'pillars',
  '交': 'diplomacy',
  '事': 'scroll',
  '守': 'shield',
  '家': 'leadership',
  '古': 'history',
  '募': 'people',
  '築': 'build',
  '談': 'chat',
  '否': 'cross',
  '可': 'check',
  '天': 'castle',
  '謀': 'intel',
  '護': 'shield',
  '蔵': 'gold',
  '領': 'map',
  '米': 'food',
  '議': 'chat',
  '征': 'military',
  '豊': 'farm',
  '商': 'market',
  '震': 'quake',
  '乱': 'fire',
  '興': 'leadership',
  '覇': 'crown',
  '滅': 'cross',
  '記': 'scroll',
  '地': 'stone',
  '陣': 'military',
  '検': 'check',
  '未': 'history',
  '位': 'ranking',
  '法': 'culture',
  '史': 'history',
  '潜': 'intel',
  '闇': 'intel',
  '失': 'cross',
  '偵': 'intel',
  '密': 'intel',
  '設': 'settings',
  '人': 'user',
  '世': 'globe',
  '練': 'barracks',
  '静': 'messages',
  '技': 'pillars',
  '効': 'star',
  '民': 'people',
  '産': 'farm',
  '祭': 'star',
  '無': 'dot',
  '勝': 'check',
  '敗': 'cross',
  '分': 'dot',
  '止': 'cross',
  '図': 'map',
  '北': 'compass',
  '全': 'expand',
  '武': 'military',
  '統': 'leadership',
  '経': 'economy',
  '文': 'culture',
  '金': 'gold',
  '木': 'wood',
  '石': 'stone',
  '鉄': 'iron',
  '田': 'farm',
  '市': 'market',
  '道': 'dojo',
  '足': 'ashigaru',
  '槍': 'yari',
  '弓': 'archer',
  '侍': 'samurai',
  '騎': 'cavalry',
};

/** Pictogram for a section or status code. Unknown codes (province names) get the map pin. */
export function Glyph({ k, ...rest }: { k: string } & Omit<Parameters<typeof Icon>[0], 'name'>) {
  return <Icon name={CODE_ICON[k] ?? 'province'} {...rest} />;
}
