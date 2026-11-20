'use client';

/**
 * How the garrison of an own province is ordered to fight. Shows the stance in
 * force, one being prepared, and lets an official who may command order
 * another. The server decides what is allowed and what it costs.
 */
import { useState } from 'react';
import type { ProvinceDetailResponse, ProvinceOwnDTO } from '@/game/api';
import { STANCE_DEFS, type StanceId } from '@/game/strategy';
import { Icon } from '@/components/icons';
import { apiPost } from '@/lib/api';
import { cx, fmtDuration, missingResources } from '@/lib/format';
import { useGame } from '@/lib/game-context';
import { useAction } from '@/lib/hooks';
import { StanceSeal, stanceDefeats } from './strategy';
import { ActionButton, CostRow, Countdown, Dialog, Panel } from './ui';

export function StancePanel({
  provinceId,
  provinceName,
  stance,
  onChanged,
  onRefresh,
}: {
  provinceId: string;
  provinceName: string;
  stance: ProvinceOwnDTO['stance'];
  onChanged: (res: ProvinceDetailResponse) => void;
  onRefresh: () => void;
}) {
  const { resources, lacks } = useGame();
  const noCommand = lacks('command');
  const action = useAction();
  const [open, setOpen] = useState(false);
  const current = STANCE_DEFS[stance.current];
  const pending = stance.pending;

  const order = async (id: StanceId) => {
    const res = await action.run(
      async () => {
        const r = await apiPost<ProvinceDetailResponse>(`/api/provinces/${provinceId}/stance`, { stance: id });
        onChanged(r);
        return r;
      },
      { success: `${provinceName}: the garrison prepares ${STANCE_DEFS[id].name}.` },
    );
    if (res) setOpen(false);
  };

  return (
    <Panel
      title="Stance of the garrison"
      icon="shield"
      action={
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
          {noCommand ? 'See stances' : 'Change'}
        </button>
      }
    >
      <div className="flex items-start gap-3">
        <StanceSeal stance={stance.current} size="lg" />
        <div className="min-w-0 flex-1 leading-snug">
          <p className="font-display text-lg font-bold">{current.name}</p>
          <p className="text-sm text-parchment/85">{current.summary}</p>
          <p className="mt-1 text-sm">
            <span className="font-bold text-gold-bright">{stanceDefeats(stance.current)}</span> <span className="text-muted">Price: {current.price}</span>
          </p>
        </div>
      </div>
      {pending ? (
        <p className="mt-3 flex items-start gap-2 rounded-[3px] border border-gold/30 bg-gold/10 px-3 py-2 text-sm">
          <Icon name="clock" className="mt-0.5 shrink-0 text-gold-bright" />
          <span>
            Preparing <strong>{STANCE_DEFS[pending.stance].name}</strong>: in force in <Countdown to={pending.readyAt} className="font-bold text-gold-bright" done="a moment" onDone={onRefresh} />. Until then{' '}
            {current.name} holds.
          </span>
        </p>
      ) : null}
      <p className="mt-2 text-xs text-muted">An attacker who guesses the stance picks a tactic it cannot stop. Enemy scouts can see it; yours can see theirs.</p>

      <Dialog open={open} onClose={() => setOpen(false)} title={`Stance of ${provinceName}`} icon="shield" wide>
        <p className="mb-3 text-sm text-muted">
          A new stance takes <strong className="text-parchment">{fmtDuration(stance.prepMs)}</strong> to prepare; the one in force holds until then. Each stance defeats one tactic and has a price.
        </p>
        <ul className="space-y-2.5">
          {stance.options.map((o) => {
            const def = STANCE_DEFS[o.id];
            const inForce = o.id === stance.current && !pending;
            const preparing = pending?.stance === o.id;
            const hasCost = Object.values(def.cost).some((v) => (v ?? 0) > 0);
            const missing = missingResources(resources, def.cost);
            const reason =
              noCommand ?? o.blockedReason ?? (inForce ? 'Already in force' : preparing ? 'Already being prepared' : missing.length > 0 ? `Not enough ${missing.join(', ')}` : null);
            return (
              <li key={o.id} className={cx('panel-flat p-3', (inForce || preparing) && '!border-gold/60 bg-gold/10')}>
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  <StanceSeal stance={o.id} />
                  <div className="min-w-0 flex-1 leading-snug">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-display text-base font-bold">{def.name}</span>
                      {o.id === stance.current ? <span className="chip chip-jade">In force</span> : null}
                      {preparing ? <span className="chip">Being prepared</span> : null}
                    </div>
                    <p className="text-xs italic text-muted">{def.maxim}</p>
                    <p className="mt-1 text-sm text-parchment/85">{def.summary}</p>
                    <p className="mt-1 text-[0.82rem]">
                      <span className="font-bold text-gold-bright">{stanceDefeats(o.id)}</span>
                    </p>
                    <p className="text-[0.82rem] text-muted">Price: {def.price}</p>
                    {hasCost ? <CostRow cost={def.cost} have={resources} className="mt-1" /> : null}
                  </div>
                  <ActionButton size="sm" variant="gold" busy={action.busy} reason={reason} onClick={() => void order(o.id)} wrapperClassName="w-full max-w-[13rem] sm:w-auto">
                    Order
                  </ActionButton>
                </div>
              </li>
            );
          })}
        </ul>
      </Dialog>
    </Panel>
  );
}
