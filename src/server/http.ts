/**
 * The API wrapper every route goes through. For each request it:
 *
 *  - rejects cross-site mutations (origin check; the session cookie is SameSite=Lax);
 *  - applies rate limits (OPS-05);
 *  - authenticates the session and, where needed, requires an active clan;
 *  - validates the JSON body against a schema;
 *  - replays the stored answer for a repeated Idempotency-Key instead of
 *    running the action twice;
 *  - brings the world up to the present before the handler runs;
 *  - turns game-rule errors into `{ error: { code, message } }` responses.
 */
import type { z } from 'zod';
import { advanceForMutation, advanceLazily, advanceWorld } from './advance';
import { authenticate, readSessionToken, type RequestMeta, type Session } from './auth';
import { one, pool, withWorldLock, type Db } from './db';
import { GameError } from './errors';
import type { ClanRow } from './rows';
import type { Viewer } from './views';
import { gameContext, type G } from './world';

export interface ApiContext<B> {
  req: Request;
  body: B;
  params: Record<string, string>;
  query: URLSearchParams;
  meta: RequestMeta;
  now: Date;
}

export interface AuthedContext<B> extends ApiContext<B> {
  session: Session;
  viewer: Viewer;
}

export interface ClanContext<B> extends AuthedContext<B> {
  /** The player's active clan. */
  clan: ClanRow;
}

interface RateRule {
  limit: number;
  windowSec: number;
}

interface Options<S extends z.ZodType | undefined> {
  /** Body schema. Omit for requests without a body. */
  body?: S;
  /** Marks a state-changing action: enables idempotency, per-player rate limiting and a blocking world advance. */
  mutation?: boolean;
  /** Extra limit by client IP (used for the auth endpoints). */
  ipRate?: RateRule;
  /** Skip bringing the world up to date (auth and housekeeping routes). */
  skipAdvance?: boolean;
}

type BodyOf<S> = S extends z.ZodType ? z.infer<S> : undefined;
type RouteArgs = { params: Promise<Record<string, string | string[] | undefined>> };
type RouteHandler = (req: Request, args: RouteArgs) => Promise<Response>;

const MUTATION_RATE: RateRule = { limit: 90, windowSec: 60 };

let worldKnownToExist = false;

/** The very first request against an empty database creates the world. */
async function ensureWorldExists(): Promise<void> {
  if (worldKnownToExist) return;
  const exists = await one(pool(), 'SELECT 1 FROM world_state WHERE id');
  if (!exists) await advanceWorld({ blocking: true, maxSteps: 1 });
  worldKnownToExist = true;
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

function errorResponse(err: unknown): Response {
  if (err instanceof GameError) return json({ error: { code: err.code, message: err.message } }, err.status);
  const pgCode = (err as { code?: string } | null)?.code;
  if (pgCode === '55P03') return json({ error: { code: 'BUSY', message: 'The world is busy. Try again in a moment.' } }, 503);
  if (pgCode === '42P01') {
    return json({ error: { code: 'NOT_MIGRATED', message: 'The database schema is missing. Run "npm run db:migrate".' } }, 503);
  }
  if (err instanceof Error && err.message.startsWith('DATABASE_URL is not set')) {
    return json({ error: { code: 'NOT_CONFIGURED', message: 'The server has no database configured (DATABASE_URL).' } }, 503);
  }
  console.error('[api] unhandled error', err);
  return json({ error: { code: 'INTERNAL', message: 'Something went wrong on the server' } }, 500);
}

function clientMeta(req: Request): RequestMeta {
  const forwarded = req.headers.get('x-forwarded-for');
  return { ip: forwarded ? forwarded.split(',')[0].trim() : null, userAgent: req.headers.get('user-agent') };
}

function assertSameOrigin(req: Request): void {
  const origin = req.headers.get('origin');
  if (!origin) return;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new GameError('FORBIDDEN', 'Bad origin', 403);
  }
  if (host && originHost !== host) throw new GameError('FORBIDDEN', 'Cross-site requests are not allowed', 403);
}

/** Fixed-window counter in PostgreSQL, so the limit holds across serverless instances. */
async function rateLimit(key: string, rule: RateRule): Promise<void> {
  const windowMs = rule.windowSec * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const row = await one<{ count: number }>(
    pool(),
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count`,
    [key, windowStart],
  );
  if ((row?.count ?? 0) > rule.limit) throw new GameError('RATE_LIMITED', 'Too many requests. Slow down and try again shortly.', 429);
}

async function parseBody<S extends z.ZodType | undefined>(req: Request, schema: S): Promise<BodyOf<S>> {
  if (!schema) return undefined as BodyOf<S>;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new GameError('INVALID', 'Request body must be JSON', 400);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
    throw new GameError('INVALID', `${where}${issue?.message ?? 'Invalid request'}`, 400);
  }
  return parsed.data as BodyOf<S>;
}

async function flattenParams(args: RouteArgs | undefined): Promise<Record<string, string>> {
  const raw = (await args?.params) ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') out[k] = v;
  return out;
}

function baseContext<B>(req: Request, body: B, params: Record<string, string>): ApiContext<B> {
  return { req, body, params, query: new URL(req.url).searchParams, meta: clientMeta(req), now: new Date() };
}

/** A route that needs no session (register, login, health). */
export function publicRoute<S extends z.ZodType | undefined = undefined>(
  opts: Options<S>,
  handler: (ctx: ApiContext<BodyOf<S>>) => Promise<unknown>,
): RouteHandler {
  return async (req, args) => {
    try {
      if (req.method !== 'GET') assertSameOrigin(req);
      const meta = clientMeta(req);
      if (opts.ipRate) await rateLimit(`ip:${new URL(req.url).pathname}:${meta.ip ?? 'local'}`, opts.ipRate);
      const body = await parseBody(req, opts.body as S);
      const result = await handler(baseContext(req, body, await flattenParams(args)));
      return result instanceof Response ? result : json(result);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

async function runIdempotent(userId: string, req: Request, run: () => Promise<unknown>): Promise<Response> {
  const key = req.headers.get('idempotency-key');
  if (!key || key.length > 128) {
    const result = await run();
    return result instanceof Response ? result : json(result);
  }
  const route = `${req.method} ${new URL(req.url).pathname}`;
  const claimed = await one(
    pool(),
    'INSERT INTO idempotency_keys (user_id, key, route) VALUES ($1, $2, $3) ON CONFLICT (user_id, key) DO NOTHING RETURNING key',
    [userId, key, route],
  );
  if (!claimed) {
    const stored = await one<{ route: string; status_code: number | null; response: unknown }>(
      pool(),
      'SELECT route, status_code, response FROM idempotency_keys WHERE user_id = $1 AND key = $2',
      [userId, key],
    );
    if (stored && stored.route !== route) throw new GameError('IDEMPOTENCY_MISMATCH', 'That idempotency key was used for a different request', 422);
    if (stored?.status_code) return json(stored.response, stored.status_code, { 'idempotent-replay': 'true' });
    throw new GameError('IN_PROGRESS', 'That request is already being processed', 409);
  }
  try {
    const result = await run();
    if (result instanceof Response) return result;
    await pool().query('UPDATE idempotency_keys SET status_code = 200, response = $3 WHERE user_id = $1 AND key = $2', [
      userId,
      key,
      JSON.stringify(result),
    ]);
    return json(result);
  } catch (err) {
    // A refused action may be corrected and retried with the same key.
    await pool().query('DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2', [userId, key]).catch(() => undefined);
    throw err;
  }
}

/** A route for a logged-in player, with or without a clan. */
export function playerRoute<S extends z.ZodType | undefined = undefined>(
  opts: Options<S>,
  handler: (ctx: AuthedContext<BodyOf<S>>) => Promise<unknown>,
): RouteHandler {
  return async (req, args) => {
    try {
      if (req.method !== 'GET') assertSameOrigin(req);
      const session = await authenticate(pool(), readSessionToken(req.headers.get('cookie')));
      if (!session) throw new GameError('UNAUTHENTICATED', 'Please log in', 401);
      if (opts.mutation) await rateLimit(`player:${session.player.id}`, MUTATION_RATE);
      const body = await parseBody(req, opts.body as S);
      const params = await flattenParams(args);
      const run = async () => {
        await ensureWorldExists();
        if (!opts.skipAdvance) {
          if (opts.mutation) await advanceForMutation();
          else await advanceLazily();
        }
        return handler({ ...baseContext(req, body, params), session, viewer: { player: session.player, clan: session.clan } });
      };
      if (opts.mutation) return await runIdempotent(session.userId, req, run);
      const result = await run();
      return result instanceof Response ? result : json(result);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** A route that needs the player to lead an active clan. */
export function clanRoute<S extends z.ZodType | undefined = undefined>(
  opts: Options<S>,
  handler: (ctx: ClanContext<BodyOf<S>>) => Promise<unknown>,
): RouteHandler {
  return playerRoute(opts, async (ctx) => {
    const clan = ctx.session.clan;
    if (!clan) throw new GameError('NO_CLAN', 'Found a clan first', 409);
    if (clan.status !== 'active') throw new GameError('CLAN_FALLEN', 'Your clan has fallen. Found a new seat to continue.', 409);
    return handler({ ...ctx, clan });
  });
}

/**
 * Run a player's order: one transaction, under the world lock, with a game
 * context stamped with the acting player for the audit log. The clan row is
 * re-read and locked inside the transaction, so the order is judged against
 * committed state rather than against what the session looked like earlier.
 */
export async function act<T>(
  ctx: { session: Session; now: Date },
  fn: (g: G, clan: ClanRow) => Promise<T>,
): Promise<T> {
  return withWorldLock(async (tx: Db) => {
    const g = await gameContext(tx, new Date(), ctx.session.player.id);
    const clan = await one<ClanRow>(tx, 'SELECT * FROM clans WHERE player_id = $1 FOR UPDATE', [ctx.session.player.id]);
    if (!clan) throw new GameError('NO_CLAN', 'Found a clan first', 409);
    if (clan.status !== 'active') throw new GameError('CLAN_FALLEN', 'Your clan has fallen. Found a new seat to continue.', 409);
    return fn(g, clan);
  });
}

export { json };
