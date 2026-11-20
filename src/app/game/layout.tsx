'use client';

import { GameShell } from '@/components/GameShell';
import { BRAND_SEAL } from '@/components/Brand';
import { ErrorState, LoadingState } from '@/components/ui';
import { GameProvider } from '@/lib/game-context';

function Gate({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="flex flex-col items-center gap-4">
        <span className="seal seal-lg" aria-hidden>
          {BRAND_SEAL}
        </span>
        {children}
      </div>
    </div>
  );
}

export default function GameLayout({ children }: { children: React.ReactNode }) {
  return (
    <GameProvider
      fallback={
        <Gate>
          <LoadingState label="Opening the castle gates…" className="!py-0" />
        </Gate>
      }
      renderError={(message, retry) => (
        <Gate>
          <ErrorState message={message} onRetry={retry} className="!py-0" />
        </Gate>
      )}
    >
      <GameShell>{children}</GameShell>
    </GameProvider>
  );
}
