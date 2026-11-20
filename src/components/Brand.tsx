import Link from 'next/link';
import { GAME_NAME, GAME_SUBTITLE } from '@/game/config';


import { Icon } from './icons';
export function Brand({ compact, href = '/game', size = 'md' }: { compact?: boolean; href?: string; size?: 'md' | 'lg' }) {
  return (
    <Link href={href} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2.5" aria-label={`${GAME_NAME}: ${GAME_SUBTITLE}`}>
      <span className={size === 'lg' ? 'seal seal-lg' : 'seal'} aria-hidden>
        <Icon name="castle" />
      </span>
      {!compact ? (
        <span className="leading-none">
          <span className={`block font-display font-extrabold tracking-[0.14em] text-parchment ${size === 'lg' ? 'text-3xl' : 'text-xl'}`}>{GAME_NAME.toUpperCase()}</span>
          <span className={`mt-1 block uppercase tracking-[0.28em] text-gold ${size === 'lg' ? 'text-[0.72rem]' : 'text-[0.6rem]'}`}>{GAME_SUBTITLE}</span>
        </span>
      ) : null}
    </Link>
  );
}
