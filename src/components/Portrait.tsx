import { bannerHex } from '@/game/config';

const INK = '#17130e';
const SKIN = '#dcc7a0';
const SKIN_SHADE = '#c2aa80';
const GOLD = '#c8a24a';
const CREAM = '#f3e7cb';

function Eyes({ y = 44, stern }: { y?: number; stern?: boolean }) {
  return (
    <g stroke={INK} strokeLinecap="round" fill="none">
      <path d={`M40,${y - (stern ? 2.6 : 2)} L46.5,${y - (stern ? 1 : 1.6)}`} strokeWidth="1.5" />
      <path d={`M60,${y - (stern ? 2.6 : 2)} L53.5,${y - (stern ? 1 : 1.6)}`} strokeWidth="1.5" />
      <path d={`M41,${y + 1.4} Q43.6,${y - 0.4} 46.4,${y + 1.2}`} strokeWidth="1.7" />
      <path d={`M59,${y + 1.4} Q56.4,${y - 0.4} 53.6,${y + 1.2}`} strokeWidth="1.7" />
    </g>
  );
}

function Face({ jaw = 62 }: { jaw?: number }) {
  return (
    <g>
      <path d={`M36,40 C36,26 64,26 64,40 L63,50 C62,57 56,${jaw} 50,${jaw + 2} C44,${jaw} 38,57 37,50 Z`} fill={SKIN} stroke={INK} strokeWidth="1.3" />
      <path d={`M58,34 C63,40 63,50 60,56 C57,${jaw - 1} 53,${jaw + 1} 50,${jaw + 2} C56,${jaw - 3} 59,52 58,34 Z`} fill={SKIN_SHADE} opacity="0.8" />
      <path d="M50,45 L49,51 L51.2,51.4" fill="none" stroke={INK} strokeWidth="0.9" strokeLinecap="round" />
    </g>
  );
}

function Shoulders({ accent, wide }: { accent: string; wide?: boolean }) {
  return (
    <g>
      <path d="M44,58 H56 V70 H44 Z" fill={SKIN_SHADE} stroke={INK} strokeWidth="1.2" />
      {wide ? (
        <path d="M4,100 L8,82 L30,66 L42,66 L50,78 L58,66 L70,66 L92,82 L96,100 Z" fill={INK} />
      ) : (
        <path d="M10,100 C12,80 28,71 42,67 L50,78 L58,67 C72,71 88,80 90,100 Z" fill={INK} />
      )}
      {/* layered collar */}
      <path d="M42,66 L50,82 L58,66 L61,68 L50,90 L39,68 Z" fill={accent} stroke={INK} strokeWidth="1" strokeLinejoin="round" />
      <path d="M44.5,66 L50,77 L55.5,66" fill="none" stroke={CREAM} strokeWidth="1.4" />
    </g>
  );
}

function Figure({ id, accent }: { id: string; accent: string }) {
  switch (id) {
    case 'general':
      return (
        <g>
          <Shoulders accent={accent} wide />
          {/* shoulder guards */}
          <path d="M6,86 L28,68 L36,74 L18,96 Z M94,86 L72,68 L64,74 L82,96 Z" fill={accent} stroke={INK} strokeWidth="1.1" />
          <path d="M12,88 L30,74 M17,92 L33,78 M88,88 L70,74 M83,92 L67,78" stroke={INK} strokeWidth="0.9" />
          <Face />
          <Eyes stern />
          {/* half mask */}
          <path d="M37,50 C42,53 58,53 63,50 C62,58 56,63 50,64 C44,63 38,58 37,50 Z" fill={INK} />
          <path d="M43,56 H57 M45,59 H55" stroke={GOLD} strokeWidth="0.8" />
          {/* helmet bowl, neck guard and crest */}
          <path d="M28,60 L33,40 L67,40 L72,60 L64,56 L64,42 L36,42 L36,56 Z" fill={INK} />
          <path d="M32,42 C31,20 69,20 68,42 Z" fill={INK} />
          <path d="M31,41 H69" stroke={GOLD} strokeWidth="2" />
          <path d="M50,22 V40 M40,25 L42,40 M60,25 L58,40" stroke={GOLD} strokeWidth="0.7" opacity="0.8" />
          <path d="M33,26 C34,6 44,2 50,12 C56,2 66,6 67,26 C62,14 55,14 50,22 C45,14 38,14 33,26 Z" fill={GOLD} stroke={INK} strokeWidth="1" strokeLinejoin="round" />
        </g>
      );
    case 'strategist':
      return (
        <g>
          <Shoulders accent={accent} />
          <Face jaw={63} />
          <Eyes />
          <path d="M45,55 Q50,53.5 55,55" fill="none" stroke={INK} strokeWidth="1.3" strokeLinecap="round" />
          <path d="M49,58.5 Q50,62 51,58.5" fill={INK} />
          {/* hairline and tall cap */}
          <path d="M35,42 C33,28 42,25 50,25 C58,25 67,28 65,42 C62,35 58,32 50,32 C42,32 38,35 35,42 Z" fill={INK} />
          <path d="M39,31 C37,12 48,2 62,6 C58,14 60,24 61,31 Z" fill={INK} />
          <path d="M39,31 H61" stroke={GOLD} strokeWidth="1.6" />
          <path d="M37,36 L33,60 M63,36 L67,60" stroke={INK} strokeWidth="1.2" />
          {/* war fan */}
          <path d="M70,98 L64,72 A26,26 0 0 1 97,82 Z" fill={accent} stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M70,98 L72,72 M70,98 L81,71 M70,98 L90,75" stroke={INK} strokeWidth="0.8" />
          <circle cx="80" cy="82" r="3.4" fill={CREAM} stroke={INK} strokeWidth="0.8" />
        </g>
      );
    case 'steward':
      return (
        <g>
          <Shoulders accent={accent} />
          {/* stiff formal shoulders */}
          <path d="M2,88 L30,64 L41,67 L33,100 L2,100 Z M98,88 L70,64 L59,67 L67,100 L98,100 Z" fill={accent} stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M10,90 L33,70 M90,90 L67,70" stroke={INK} strokeWidth="0.8" opacity="0.7" />
          <Face />
          <Eyes />
          <path d="M45.5,56.5 Q50,58 54.5,56.5" fill="none" stroke={INK} strokeWidth="1.1" strokeLinecap="round" />
          {/* shaved crown with topknot */}
          <path d="M35,43 C33,30 39,25 44,25 C42,30 41,34 40,40 Z M65,43 C67,30 61,25 56,25 C58,30 59,34 60,40 Z" fill={INK} />
          <path d="M46,27 C47,17 53,17 54,27 L52.5,31 H47.5 Z" fill={INK} />
          <path d="M47,25 H53" stroke={CREAM} strokeWidth="1" />
        </g>
      );
    case 'shadow':
      return (
        <g>
          <Shoulders accent={INK} />
          <path d="M40,66 L50,84 L60,66 L64,70 L50,94 L36,70 Z" fill={accent} stroke={INK} strokeWidth="1" />
          {/* sword over the shoulder */}
          <path d="M66,66 L88,26" stroke={INK} strokeWidth="4.2" strokeLinecap="round" />
          <path d="M70,58 L86,30" stroke={accent} strokeWidth="1.4" strokeDasharray="2.4 2.4" />
          <rect x="62.5" y="60" width="9" height="3.4" rx="1" fill={GOLD} stroke={INK} strokeWidth="0.7" transform="rotate(29 67 61.7)" />
          {/* cowl with only the eyes showing */}
          <path d="M31,50 C28,22 72,22 69,50 L67,62 C62,70 38,70 33,62 Z" fill={INK} />
          <path d="M37,40 C42,37.5 58,37.5 63,40 L62.5,47.5 C57,49.5 43,49.5 37.5,47.5 Z" fill={SKIN} stroke={INK} strokeWidth="1" />
          <Eyes y={44.2} stern />
          <path d="M33,58 C27,66 24,74 26,84 M36,62 C33,70 32,76 34,82" stroke={INK} strokeWidth="2.6" strokeLinecap="round" fill="none" />
        </g>
      );
    case 'sage':
      return (
        <g>
          <Shoulders accent={CREAM} />
          {/* stole across the robe */}
          <path d="M24,74 L42,67 L74,100 L50,100 Z" fill={accent} stroke={INK} strokeWidth="1.1" strokeLinejoin="round" />
          <path d="M30,74 L62,100 M36,71 L68,98" stroke={GOLD} strokeWidth="0.8" opacity="0.9" />
          <Face jaw={61} />
          <Eyes y={45} />
          <path d="M39,39 Q43,36.5 47,39.4 M61,39 Q57,36.5 53,39.4" fill="none" stroke={CREAM} strokeWidth="2.4" strokeLinecap="round" />
          {/* beard */}
          <path d="M40,54 C42,57 47,57.5 50,56 C53,57.5 58,57 60,54 C60,68 55,80 50,88 C45,80 40,68 40,54 Z" fill={CREAM} stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M46,62 L48,78 M54,62 L52,78 M50,60 V84" stroke={INK} strokeWidth="0.7" opacity="0.6" />
          {/* prayer beads */}
          <path d="M33,70 C36,92 64,92 67,70" fill="none" stroke={GOLD} strokeWidth="3" strokeDasharray="0.1 4.6" strokeLinecap="round" />
        </g>
      );
    case 'lady':
      return (
        <g>
          {/* glaive behind */}
          <path d="M84,100 L78,30" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
          <path d="M78,31 C72,22 74,10 80,4 C84,12 84,22 80.5,31 Z" fill={CREAM} stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
          <rect x="74.5" y="30" width="8" height="2.8" rx="1" fill={GOLD} stroke={INK} strokeWidth="0.7" transform="rotate(-5 78.5 31.4)" />
          {/* long hair */}
          <path d="M33,46 C29,18 71,18 67,46 L73,88 L62,74 L62,46 L38,46 L38,74 L27,88 Z" fill={INK} />
          <Shoulders accent={accent} />
          <Face jaw={61} />
          <Eyes y={44.6} />
          <path d="M46.5,56 Q50,57.6 53.5,56" fill="none" stroke="#8a2a2d" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M35,42 C34,27 44,25 50,29 C56,25 66,27 65,42 C61,35 56,33 50,36 C44,33 39,35 35,42 Z" fill={INK} />
          {/* headband */}
          <path d="M35.4,35.5 C42,32.5 58,32.5 64.6,35.5 L64.8,39 C58,36 42,36 35.2,39 Z" fill={CREAM} stroke={INK} strokeWidth="0.9" />
          <path d="M64,37 C70,40 72,48 70,56 M65,36 C73,38 77,45 76,52" stroke={CREAM} strokeWidth="2" fill="none" strokeLinecap="round" />
          <circle cx="50" cy="35.2" r="2" fill={accent} stroke={INK} strokeWidth="0.7" />
        </g>
      );
    default:
      return (
        <g>
          <Shoulders accent={accent} />
          <Face />
          <Eyes />
        </g>
      );
  }
}

/**
 * Daimyo portrait: an original stylised ink bust on a parchment disc.
 * `accent` is a banner colour id; it tints the robes.
 */
export function Portrait({ id, accent = 'crimson', size = 64, className, title }: { id: string; accent?: string; size?: number; className?: string; title?: string }) {
  const clip = `pt-${id}-${accent}-${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <clipPath id={clip}>
          <circle cx="50" cy="50" r="46" />
        </clipPath>
        <radialGradient id={`${clip}-bg`} cx="0.4" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#f4ead2" />
          <stop offset="0.7" stopColor="#d9c9a4" />
          <stop offset="1" stopColor="#a8936a" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48.5" fill="#110e0a" />
      <circle cx="50" cy="50" r="46" fill={`url(#${clip}-bg)`} />
      <g clipPath={`url(#${clip})`}>
        {/* rising sun wash behind the figure */}
        <circle cx="50" cy="40" r="27" fill="#9b2d30" opacity="0.2" />
        <Figure id={id} accent={bannerHex(accent)} />
      </g>
      <circle cx="50" cy="50" r="46" fill="none" stroke={GOLD} strokeWidth="2" />
      <circle cx="50" cy="50" r="48.5" fill="none" stroke="#110e0a" strokeWidth="1" />
    </svg>
  );
}
