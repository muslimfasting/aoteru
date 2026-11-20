import Link from 'next/link';
import { GAME_TAGLINE } from '@/game/config';
import { Brand } from './Brand';

/** Shared frame for the sign-in and registration screens. */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      <div className="vertical-text pointer-events-none absolute right-4 top-8 hidden select-none font-display text-5xl font-bold text-parchment/[0.06] sm:block lg:right-16 lg:text-7xl" aria-hidden>
        天下統一
      </div>
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Brand href="/" size="lg" />
          <p className="text-sm text-muted">{GAME_TAGLINE}</p>
        </div>
        <div className="paper p-5 sm:p-7">
          <h1 className="font-display text-2xl font-extrabold">{title}</h1>
          <p className="mt-1 text-sm text-ink-700">{subtitle}</p>
          <div className="mt-5">{children}</div>
        </div>
        <div className="mt-4 text-center text-sm text-muted">{footer}</div>
        <p className="mt-6 text-center text-xs text-faint">
          <Link href="/" className="tap-link hover:text-muted">
            About the game
          </Link>
        </p>
      </div>
    </div>
  );
}

export function FormField({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-bold">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs font-bold text-vermilion-deep [.panel_&]:text-vermilion-bright">{error}</span> : hint ? <span className="mt-1 block text-xs text-ink-600 [.panel_&]:text-muted">{hint}</span> : null}
    </label>
  );
}
