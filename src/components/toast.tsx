'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
}

interface ToastApi {
  success: (title: string, body?: string) => void;
  error: (title: string, body?: string) => void;
  info: (title: string, body?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const KIND_STYLE: Record<ToastKind, { seal: string; cls: string; border: string }> = {
  success: { seal: '可', cls: 'seal-gold', border: 'border-gold/50' },
  error: { seal: '否', cls: '', border: 'border-vermilion-bright/60' },
  info: { seal: '報', cls: 'seal-ink', border: 'border-gold/30' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, title: string, body?: string) => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-3), { id, kind, title, body }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 6500 : 4200);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (t, b) => push('success', t, b),
      error: (t, b) => push('error', t, b),
      info: (t, b) => push('info', t, b),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-[80] flex flex-col items-center gap-2 px-3 lg:inset-x-auto lg:right-5 lg:items-end"
        style={{ bottom: 'calc(84px + var(--safe-bottom))' }}
        role="region"
        aria-live="polite"
        aria-label="Notifications"
      >
        {items.map((t) => {
          const style = KIND_STYLE[t.kind];
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => dismiss(t.id)}
              className={`pointer-events-auto flex w-full max-w-sm animate-rise items-start gap-3 rounded-[4px] border ${style.border} bg-ink-850/95 p-3 text-left shadow-2xl backdrop-blur`}
            >
              <span className={`seal seal-sm mt-0.5 ${style.cls}`} aria-hidden>
                {style.seal}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-parchment">{t.title}</span>
                {t.body ? <span className="mt-0.5 block text-xs text-muted">{t.body}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
