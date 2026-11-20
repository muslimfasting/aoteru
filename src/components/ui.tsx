'use client';

import { useEffect, useId, useRef } from 'react';
import { RESOURCE_INFO, RESOURCE_KEYS, UNITS, UNIT_TYPES, type ResourceBag, type UnitCounts } from '@/game/config';
import { useNow } from '@/lib/clock';
import { cx, fmt, fmtClock, fmtDuration } from '@/lib/format';

import { Glyph, Icon } from '@/components/icons';
// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

export function Panel({
  title,
  kanji,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: React.ReactNode;
  kanji?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx('panel', className)}>
      {title ? (
        <header className="flex items-center gap-3 border-b border-gold/15 px-4 py-3">
          {kanji ? (
            <span className="seal seal-sm seal-ink" aria-hidden>
              <Glyph k={kanji} />
            </span>
          ) : null}
          <h2 className="min-w-0 flex-1 truncate font-display text-[1.02rem] font-bold tracking-wide text-parchment">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className={cx('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({
  kanji,
  title,
  subtitle,
  action,
}: {
  kanji: string;
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-4 flex items-center gap-3 lg:mb-5">
      <span className="seal seal-lg hidden sm:inline-grid" aria-hidden>
        <Glyph k={kanji} />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-2xl font-extrabold leading-tight tracking-wide text-parchment lg:text-[1.75rem]">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function Seal({ children, tone, size, className }: { children: React.ReactNode; tone?: 'red' | 'gold' | 'ink'; size?: 'sm' | 'lg'; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx('seal', tone === 'gold' && 'seal-gold', tone === 'ink' && 'seal-ink', size === 'sm' && 'seal-sm', size === 'lg' && 'seal-lg', className)}
    >
      {children}
    </span>
  );
}

export function Stat({ label, value, hint, className }: { label: string; value: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="text-[0.66rem] uppercase tracking-[0.1em] text-muted">{label}</div>
      <div className="num truncate font-display text-xl font-bold leading-tight">{value}</div>
      {hint ? <div className="text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

export function Bar({ value, max, tone, className, label }: { value: number; max: number; tone?: 'gold' | 'red' | 'jade'; className?: string; label?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const bg =
    tone === 'red'
      ? 'linear-gradient(90deg,#7d2225,#c5484b)'
      : tone === 'jade'
        ? 'linear-gradient(90deg,#3f6d54,#7fb898)'
        : undefined;
  return (
    <div className={cx('bar', className)} role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value)} aria-label={label}>
      <span style={{ width: `${pct}%`, background: bg }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx('inline-block h-4 w-4 animate-spin rounded-full border-2 border-gold/30 border-t-gold', className)}
      role="status"
      aria-label="Loading"
    />
  );
}

export function LoadingState({ label = 'Unrolling the scrolls…', className }: { label?: string; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center justify-center gap-3 py-12 text-muted', className)}>
      <Spinner className="h-6 w-6" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center justify-center gap-3 py-10 text-center', className)}>
      <Seal><Glyph k="否" /></Seal>
      <p className="max-w-sm text-sm text-parchment">{message}</p>
      {onRetry ? (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ kanji = '無', title, children, className }: { kanji?: string; title: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center justify-center gap-2 py-8 text-center', className)}>
      <Seal tone="ink"><Glyph k={kanji} /></Seal>
      <p className="font-display text-base font-bold text-parchment">{title}</p>
      {children ? <div className="max-w-sm text-sm text-muted">{children}</div> : null}
    </div>
  );
}

/** Loading / error / content switch shared by every screen. */
export function Async<T>({
  state,
  children,
  loadingLabel,
}: {
  state: { data: T | undefined; error: Error | null; loading: boolean; refresh: () => void | Promise<void> };
  children: (data: T) => React.ReactNode;
  loadingLabel?: string;
}) {
  if (state.data !== undefined) return <>{children(state.data)}</>;
  if (state.error) return <ErrorState message={state.error.message} onRetry={() => void state.refresh()} />;
  return <LoadingState label={loadingLabel} />;
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

/**
 * A button that says why it is disabled. `reason` both disables the button and
 * is printed under it, so the explanation is visible on touch screens too.
 */
export function ActionButton({
  children,
  reason,
  busy,
  variant = 'default',
  size,
  className,
  wrapperClassName,
  ...rest
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> & {
  reason?: string | null;
  busy?: boolean;
  variant?: 'default' | 'primary' | 'gold' | 'ghost' | 'ink';
  size?: 'sm';
  wrapperClassName?: string;
}) {
  const disabled = Boolean(reason) || busy;
  return (
    <span className={cx('inline-flex flex-col items-stretch gap-1', wrapperClassName)}>
      <button
        type="button"
        {...rest}
        disabled={disabled}
        title={reason ?? undefined}
        className={cx(
          'btn',
          variant === 'primary' && 'btn-primary',
          variant === 'gold' && 'btn-gold',
          variant === 'ghost' && 'btn-ghost',
          variant === 'ink' && 'btn-ink',
          size === 'sm' && 'btn-sm',
          className,
        )}
      >
        {busy ? <Spinner /> : null}
        {children}
      </button>
      {reason ? <span className="text-center text-[0.72rem] leading-snug text-vermilion-bright [.paper_&]:text-vermilion-deep">{reason}</span> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Dialog: centred modal on desktop, bottom sheet on phones
// ---------------------------------------------------------------------------

export function Dialog({
  open,
  onClose,
  title,
  kanji,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  kanji?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          'panel relative flex max-h-[92dvh] w-full animate-rise flex-col rounded-b-none bg-ink-850 outline-none sm:max-h-[88dvh] sm:rounded-b-[4px]',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md',
        )}
        style={{ background: 'linear-gradient(180deg,#2a241b,#191510)' }}
      >
        <header className="flex items-center gap-3 border-b border-gold/20 px-4 py-3">
          {kanji ? <Seal size="sm"><Glyph k={kanji} /></Seal> : null}
          <h2 id={titleId} className="min-w-0 flex-1 truncate font-display text-lg font-bold">
            {title}
          </h2>
          <button type="button" className="btn btn-ghost btn-sm -mr-2 !min-h-[44px] !min-w-[44px] text-lg" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer ? (
          <footer className="flex flex-wrap items-start justify-end gap-2 border-t border-gold/20 px-4 py-3" style={{ paddingBottom: 'calc(0.75rem + var(--safe-bottom))' }}>
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  kanji,
  children,
  confirmLabel,
  busy,
  danger,
  blockedReason,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  kanji?: string;
  children: React.ReactNode;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
  /** Why the action cannot be confirmed right now; disables the confirm button and is shown beneath it. */
  blockedReason?: string | null;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      kanji={kanji}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <ActionButton variant={danger ? 'primary' : 'gold'} onClick={onConfirm} busy={busy} reason={blockedReason}>
            {confirmLabel}
          </ActionButton>
        </>
      }
    >
      <div className="space-y-3 text-sm text-parchment/90">{children}</div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { id: T; label: string; badge?: number | null }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cx('flex gap-1 overflow-x-auto border-b border-gold/20', className)}>
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cx(
              'relative flex min-h-[44px] shrink-0 items-center gap-2 px-3.5 font-display text-[0.95rem] font-bold tracking-wide transition-colors',
              active ? 'text-gold-bright' : 'text-muted hover:text-parchment',
            )}
          >
            {t.label}
            {t.badge ? <span className="num rounded-sm bg-vermilion px-1.5 py-0.5 font-body text-[0.65rem] font-bold text-parchment-light">{t.badge}</span> : null}
            {active ? <span className="absolute inset-x-2 -bottom-px h-0.5 bg-gold" /> : null}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * Counts down to a server timestamp. Calls `onDone` once shortly after it hits
 * zero so the screen can refetch (which also lets the server apply the result).
 */
export function Countdown({ to, onDone, className, done = 'done' }: { to: string; onDone?: () => void; className?: string; done?: string }) {
  const now = useNow();
  const target = Date.parse(to);
  const remaining = target - now;
  const fired = useRef<string | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (now === 0 || remaining > 0 || fired.current === to) return;
    fired.current = to;
    const t1 = setTimeout(() => onDoneRef.current?.(), 700);
    const t2 = setTimeout(() => onDoneRef.current?.(), 4000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [now, remaining, to]);

  if (now === 0) return <span className={cx('num', className)}>—</span>;
  return <span className={cx('num', className)}>{remaining > 0 ? fmtClock(remaining) : done}</span>;
}

/** Progress bar between two server timestamps, with a countdown. */
export function TimedProgress({ from, to, onDone, label }: { from: string; to: string; onDone?: () => void; label?: string }) {
  const now = useNow();
  const start = Date.parse(from);
  const end = Date.parse(to);
  const total = Math.max(1, end - start);
  const elapsed = now === 0 ? 0 : Math.max(0, Math.min(total, now - start));
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-muted [.paper_&]:text-ink-600">{label}</span>
        <Countdown to={to} onDone={onDone} className="font-medium text-gold-bright [.paper_&]:text-vermilion-deep" done="finishing…" />
      </div>
      <Bar value={elapsed} max={total} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Game-specific fragments
// ---------------------------------------------------------------------------

/** Cost as a row of resource chips; amounts the clan cannot pay are shown in red. */
export function CostRow({ cost, have, className }: { cost: Partial<ResourceBag>; have?: ResourceBag | null; className?: string }) {
  const keys = RESOURCE_KEYS.filter((k) => (cost[k] ?? 0) > 0);
  if (keys.length === 0) return <span className={cx('text-xs text-muted', className)}>Free</span>;
  return (
    <span className={cx('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      {keys.map((k) => {
        const lacking = have ? have[k] < (cost[k] ?? 0) : false;
        return (
          <span
            key={k}
            className={cx('num inline-flex items-center gap-1 text-[0.82rem]', lacking ? 'font-bold text-vermilion-bright [.paper_&]:text-vermilion-deep' : '')}
            title={`${RESOURCE_INFO[k].name}${lacking ? ' — not enough' : ''}`}
          >
            <span className="font-display text-[0.8rem] font-bold text-gold [.paper_&]:text-vermilion-deep" aria-hidden>
              <Icon name={k} />
            </span>
            <span className="sr-only">{RESOURCE_INFO[k].name}</span>
            {fmt(cost[k]!)}
          </span>
        );
      })}
    </span>
  );
}

/** Compact troop composition, e.g. 足 80  槍 30. */
export function UnitsRow({ units, className, showZero }: { units: Partial<UnitCounts>; className?: string; showZero?: boolean }) {
  const types = UNIT_TYPES.filter((t) => showZero || (units[t] ?? 0) > 0);
  if (types.length === 0) return <span className={cx('text-sm text-muted', className)}>No soldiers</span>;
  return (
    <span className={cx('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      {types.map((t) => (
        <span key={t} className="num inline-flex items-center gap-1.5 text-sm" title={UNITS[t].name}>
          <span className="seal seal-sm seal-ink !h-5 !w-5 !text-[0.7rem]" aria-hidden>
            <Icon name={t} />
          </span>
          <span className="sr-only">{UNITS[t].name}</span>
          {fmt(units[t] ?? 0)}
        </span>
      ))}
    </span>
  );
}

export function DurationText({ ms }: { ms: number }) {
  return <span className="num">{fmtDuration(ms)}</span>;
}

/** Integer stepper with a slider, sized for thumbs. */
export function NumberStepper({
  value,
  max,
  onChange,
  step = 10,
  label,
}: {
  value: number;
  max: number;
  onChange: (n: number) => void;
  step?: number;
  label: string;
}) {
  const clamp = (n: number) => Math.max(0, Math.min(max, Math.floor(Number.isFinite(n) ? n : 0)));
  return (
    <div className="flex items-center gap-2">
      <button type="button" className="btn btn-sm !min-h-[44px] !min-w-[44px] !px-0 text-lg" onClick={() => onChange(clamp(value - step))} disabled={value <= 0} aria-label={`Fewer ${label}`}>
        −
      </button>
      <input
        type="range"
        className="range min-w-0 flex-1"
        min={0}
        max={Math.max(0, max)}
        value={Math.min(value, max)}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        disabled={max <= 0}
        aria-label={label}
      />
      <button type="button" className="btn btn-sm !min-h-[44px] !min-w-[44px] !px-0 text-lg" onClick={() => onChange(clamp(value + step))} disabled={value >= max} aria-label={`More ${label}`}>
        +
      </button>
      <input
        type="number"
        inputMode="numeric"
        className="field num !w-[4.6rem] shrink-0 !px-2 text-center"
        min={0}
        max={max}
        value={value === 0 ? '' : value}
        placeholder="0"
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        aria-label={`${label} count`}
      />
    </div>
  );
}
