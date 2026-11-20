import type { MarchPreviewResponse } from '@/game/api';
import { pool } from '@/server/db';
import { clanRoute } from '@/server/http';
import { planMarch } from '@/server/military';
import { marchBody } from '@/server/schemas';
import { tacticOptions } from '@/server/warviews';
import { gameMs, loadWorldState } from '@/server/world';

export const dynamic = 'force-dynamic';

/** POST /api/army/preview — what a march order would do, without giving it. Changes nothing. */
export const POST = clanRoute({ body: marchBody }, async ({ clan, body, now, viewer }): Promise<MarchPreviewResponse> => {
  const plan = await planMarch({ tx: pool(), now }, clan, body.fromProvinceId, body.toProvinceId, body.units);
  const state = await loadWorldState(pool());
  const speed = state?.speed ?? 1;
  const attack = plan.intent === 'attack' && plan.target;
  const options = attack ? await tacticOptions(pool(), clan, viewer.player.id, plan.units, plan.target, now, speed) : { tactics: [], knownStance: null };
  return {
    ok: plan.ok,
    reason: plan.reason,
    intent: plan.intent,
    path: plan.route.map((p) => p.id),
    durationMs: plan.minutes > 0 ? gameMs({ speed }, plan.minutes) : 0,
    supplies: plan.supplies,
    tactics: options.tactics,
    knownStance: options.knownStance,
  };
});
