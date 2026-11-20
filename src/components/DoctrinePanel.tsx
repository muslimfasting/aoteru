'use client';

/**
 * The nation's doctrine: its way of war. Shown to every official; chosen by
 * the Chancellor, and kept for a while once chosen.
 */
import { useState } from 'react';
import type { ClanHubResponse } from '@/game/api';
import { DOCTRINES, DOCTRINE_COOLDOWN_HOURS, DOCTRINE_DEFS, ROLE_DEFS, type DoctrineId } from '@/game/clan';
import { Icon, type IconName } from '@/components/icons';
import { apiPost } from '@/lib/api';
import { useNow } from '@/lib/clock';
import { cx } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { ActionButton, ConfirmDialog, Countdown, Dialog, Panel } from './ui';

export const DOCTRINE_ICON: Record<DoctrineId, IconName> = {
  aggressive: 'cavalry',
  defensive: 'shield',
  intelligence: 'intel',
  diplomatic: 'diplomacy',
};

/** "+6% damage" reads as a gain, "-5% protection" as a price. */
export function DoctrineEffects({ doctrine, className }: { doctrine: DoctrineId; className?: string }) {
  return (
    <ul className={cx('space-y-0.5 text-sm', className)}>
      {DOCTRINE_DEFS[doctrine].effects.map((e) => {
        const price = e.trim().startsWith('-');
        return (
          <li key={e} className="flex items-start gap-2">
            <Icon name={price ? 'cross' : 'check'} className={cx('mt-0.5 shrink-0', price ? 'text-vermilion-bright' : 'text-jade')} />
            <span className="text-parchment/90">{e.replace(/^-/, '−')}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function DoctrinePanel({ hub, onChanged }: { hub: ClanHubResponse; onChanged: (res: ClanHubResponse) => void }) {
  const now = useNow();
  const action = useAction();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<DoctrineId | null>(null);
  const isLeader = hub.membership.role === 'leader';
  const current = hub.doctrine.current;
  const def = current ? DOCTRINE_DEFS[current] : null;
  const lockedUntil = hub.doctrine.changeAvailableAt && Date.parse(hub.doctrine.changeAvailableAt) > now ? hub.doctrine.changeAvailableAt : null;
  const days = Math.round(DOCTRINE_COOLDOWN_HOURS / 24);

  const adopt = async () => {
    if (!choice) return;
    const res = await action.run(
      async () => {
        const r = await apiPost<ClanHubResponse>('/api/clan/doctrine', { doctrine: choice });
        onChanged(r);
        return r;
      },
      { success: `The nation follows the ${DOCTRINE_DEFS[choice].name}.` },
    );
    if (res) {
      setChoice(null);
      setOpen(false);
    }
  };

  return (
    <Panel
      title="Doctrine"
      icon="doctrine"
      action={
        isLeader && !hub.fallen ? (
          <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
            {current ? 'Change' : 'Choose'}
          </button>
        ) : undefined
      }
    >
      {def && current ? (
        <div className="flex items-start gap-3">
          <span className="seal seal-lg seal-gold shrink-0" aria-hidden>
            <Icon name={DOCTRINE_ICON[current]} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-bold leading-tight">{def.name}</p>
            <p className="text-sm italic text-muted">{def.motto}</p>
            <p className="mt-1 text-sm text-parchment/85">{def.summary}</p>
            <DoctrineEffects doctrine={current} className="mt-2" />
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">
          The nation follows no doctrine yet. A doctrine gives an edge in one way of war and a small price elsewhere; it never forbids anything.
        </p>
      )}
      <p className="mt-3 text-xs text-muted">
        {lockedUntil ? (
          <>
            It can be changed in <Countdown to={lockedUntil} className="font-bold text-gold-bright" done="a moment" />.
          </>
        ) : isLeader ? (
          `Once chosen, a doctrine is kept for ${days} days.`
        ) : (
          `The ${ROLE_DEFS.leader.name} chooses the doctrine.`
        )}
      </p>

      <Dialog open={open} onClose={() => setOpen(false)} title="Choose the nation's doctrine" icon="doctrine" wide>
        <p className="mb-3 text-sm text-muted">An edge, never a restriction: every tactic and every stance stays open to you. A doctrine must be kept for {days} days.</p>
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {DOCTRINES.map((id) => {
            const d = DOCTRINE_DEFS[id];
            const isCurrent = id === current;
            return (
              <li key={id} className={cx('panel-flat flex flex-col p-3', isCurrent && '!border-gold/60 bg-gold/10')}>
                <div className="flex items-center gap-2.5">
                  <span className="seal seal-sm seal-ink" aria-hidden>
                    <Icon name={DOCTRINE_ICON[id]} />
                  </span>
                  <div className="min-w-0 leading-tight">
                    <p className="font-display text-base font-bold">{d.name}</p>
                    <p className="text-xs italic text-muted">{d.motto}</p>
                  </div>
                </div>
                <p className="mt-2 text-sm text-parchment/85">{d.summary}</p>
                <DoctrineEffects doctrine={id} className="mt-2 flex-1" />
                <ActionButton
                  size="sm"
                  variant="gold"
                  className="mt-3"
                  reason={isCurrent ? 'The nation already follows it' : lockedUntil ? 'The present doctrine must be kept a while longer' : null}
                  onClick={() => setChoice(id)}
                >
                  Adopt
                </ActionButton>
              </li>
            );
          })}
        </ul>
      </Dialog>

      <ConfirmDialog
        open={choice !== null}
        onClose={() => setChoice(null)}
        onConfirm={() => void adopt()}
        busy={action.busy}
        icon="doctrine"
        title={choice ? `Adopt the ${DOCTRINE_DEFS[choice].name}?` : 'Adopt a doctrine'}
        confirmLabel="Adopt the doctrine"
      >
        {choice ? (
          <>
            <p>
              {DOCTRINE_DEFS[choice].motto} {DOCTRINE_DEFS[choice].summary}
            </p>
            <DoctrineEffects doctrine={choice} />
            <p className="text-muted">The whole nation is told, and the doctrine cannot be changed again for {days} days.</p>
          </>
        ) : null}
      </ConfirmDialog>
    </Panel>
  );
}
