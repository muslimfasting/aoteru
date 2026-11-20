import { bannerHex } from '@/game/config';

const CREAM = '#f3e7cb';

/**
 * Clan crests (mon). Original geometric designs drawn on a 20×20 field
 * centred on the origin; they inherit `currentColor`.
 */
export function MonGlyph({ mon }: { mon: string }) {
  switch (mon) {
    case 'tomoe': {
      const comma = 'M0,-7.8 A7.8,7.8 0 0 1 7.33,2.67 A9.5,9.5 0 0 0 2.9,-3.2 A3.2,3.2 0 1 1 0,-7.8 Z';
      return (
        <g>
          {[0, 120, 240].map((a) => (
            <path key={a} d={comma} transform={`rotate(${a})`} />
          ))}
        </g>
      );
    }
    case 'diamonds': {
      const d = (cx: number, cy: number) => `M${cx},${cy - 3.5} L${cx + 3.5},${cy} L${cx},${cy + 3.5} L${cx - 3.5},${cy} Z`;
      return <path d={`${d(0, -4.3)} ${d(4.3, 0)} ${d(0, 4.3)} ${d(-4.3, 0)}`} />;
    }
    case 'bars':
      return (
        <g>
          <circle r="7.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="-5.3" y="-3.7" width="10.6" height="2.5" />
          <rect x="-5.3" y="1.2" width="10.6" height="2.5" />
        </g>
      );
    case 'ring':
      return <circle r="5.8" fill="none" stroke="currentColor" strokeWidth="3.6" />;
    case 'blossom':
      return (
        <g>
          {[0, 72, 144, 216, 288].map((a) => (
            <ellipse key={a} cx="0" cy="-4.9" rx="2.7" ry="3.3" transform={`rotate(${a})`} />
          ))}
          <circle r="1.5" />
        </g>
      );
    case 'peaks':
      return <path d="M-8.5,5.5 L-4.2,-1.2 L-2.6,1.4 L0,-7.2 L2.6,1.4 L4.2,-1.2 L8.5,5.5 Z" />;
    case 'crescent':
      return <path d="M2,-7.75 A8,8 0 1 0 7.75,-2 A6.1,6.1 0 1 1 2,-7.75 Z" />;
    case 'waves':
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          <path d="M-7.2,-4 q3.6,-4.4 7.2,0 t7.2,0" />
          <path d="M-7.2,0.8 q3.6,-4.4 7.2,0 t7.2,0" />
          <path d="M-7.2,5.6 q3.6,-4.4 7.2,0 t7.2,0" />
        </g>
      );
    default:
      return <circle r="4" />;
  }
}

/** Round crest badge in the nation colour. Used in lists and on the map. */
export function MonBadge({ color, mon, size = 28, className, title }: { color: string; mon: string; size?: number; className?: string; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="-12 -12 24 24" className={className} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <circle r="11.2" fill={bannerHex(color)} stroke="rgba(13,11,8,0.85)" strokeWidth="1.2" />
      <circle r="9.9" fill="none" stroke="rgba(243,231,203,0.35)" strokeWidth="0.5" />
      <g fill={CREAM} color={CREAM} transform="scale(0.86)">
        <MonGlyph mon={mon} />
      </g>
    </svg>
  );
}

/** Unclaimed land carries no banner: a plain, weathered roundel. */
export function NeutralBadge({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="-12 -12 24 24" className={className} aria-hidden>
      <circle r="11.2" fill="#8d8068" stroke="rgba(13,11,8,0.85)" strokeWidth="1.2" />
      <path d="M-6,-6 L6,6 M-6,0 L0,6 M0,-6 L6,0" stroke="rgba(13,11,8,0.4)" strokeWidth="1.2" />
    </svg>
  );
}

/**
 * Nobori war banner: a tall flag on a pole with the nation crest.
 * `size` is the rendered height in pixels.
 */
export function Banner({ color, mon, size = 56, className, title }: { color: string; mon: string; size?: number; className?: string; title?: string }) {
  const hex = bannerHex(color);
  const width = (size * 44) / 72;
  const id = `bn-${color}-${mon}`;
  return (
    <svg width={width} height={size} viewBox="0 0 44 72" className={className} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.28" />
          <stop offset="0.25" stopColor="#fff" stopOpacity="0.07" />
          <stop offset="0.6" stopColor="#000" stopOpacity="0.06" />
          <stop offset="1" stopColor="#000" stopOpacity="0.3" />
        </linearGradient>
      </defs>
      {/* pole and crossbar */}
      <path d="M5,2 V71" stroke="#0f0c08" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M5,2 V71" stroke="#5a4a2f" strokeWidth="1" strokeLinecap="round" />
      <path d="M4,6 H40" stroke="#0f0c08" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="5" cy="2.6" r="2.2" fill="#c8a24a" stroke="#0f0c08" strokeWidth="0.7" />
      {/* loops */}
      {[14, 24, 34, 44, 54].map((y) => (
        <rect key={y} x="5" y={y} width="5" height="2.2" fill={hex} stroke="#0f0c08" strokeWidth="0.5" />
      ))}
      {[14, 24, 34].map((x) => (
        <rect key={x} x={x} y="6" width="2.4" height="4" fill={hex} stroke="#0f0c08" strokeWidth="0.5" />
      ))}
      {/* cloth */}
      <path d="M9,9 H40 V60 Q32,63 24.5,60 T9,60 Z" fill={hex} stroke="#0f0c08" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M9,9 H40 V60 Q32,63 24.5,60 T9,60 Z" fill={`url(#${id})`} />
      <path d="M11,48 H38 M11,51.5 H38" stroke={CREAM} strokeOpacity="0.55" strokeWidth="1.1" />
      <g transform="translate(24.5 27) scale(1.28)" fill={CREAM} color={CREAM}>
        <MonGlyph mon={mon} />
      </g>
    </svg>
  );
}
