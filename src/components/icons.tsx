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
