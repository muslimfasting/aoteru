import { act, playerRoute } from '@/server/http';
import { updateSettings } from '@/server/members';
import { freshHub } from '@/server/respond';
import { clanSettingsBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

/** POST /api/clan/settings — description, recruitment and language. */
export const POST = playerRoute({ body: clanSettingsBody, mutation: true }, async (ctx) => {
  const me = ctx.session.player;
  await act(ctx, (g, clan, member) => updateSettings(g, clan, me, ctx.body), { permission: 'manage_clan', allowFallen: true });
  return freshHub(ctx.req, ctx.now);
});
