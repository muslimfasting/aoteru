# Aoteru: Rise of Japan

*Unite the Clans. Conquer Japan. Become Shogun.*

A persistent, server-authoritative multiplayer grand strategy game set in Sengoku-era Japan. This repository is the **first playable prototype** from the game design document (§24): one region (Kansai), ten provinces, two NPC daimyo, all six resources, five buildings, the Five Pillars, five unit types, and the complete loop from founding a clan to conquering a neighbouring province — in a shared world that keeps running while everyone is offline.

| Japan map (desktop) | Province sheet (phone) |
|---|---|
| ![The Kansai map with a province selected](docs/screenshots/map-desktop.jpg) | ![Province detail as a bottom sheet on a phone](docs/screenshots/province-sheet-mobile.jpg) |

More in [`docs/screenshots`](docs/screenshots): overview, castle, Five Pillars and a battle report.

## What you can do in the prototype

1. Register, create a Daimyo and found a clan with its own banner on a starting province.
2. Build and upgrade the Castle, Farm, Market, Barracks and Dojo (timed, with prerequisites).
3. Watch gold, food, wood, stone and iron come in every world tick; feed the population and the army.
4. Level the Five Pillars through play and spend skill points in five skill trees with exclusive branches.
5. Recruit Ashigaru, Yari, Archers, Samurai and Cavalry; march armies through your land.
6. Attack unclaimed provinces, NPC daimyo or other players; read a round-by-round battle report.
7. Declare war, make peace, scout rival provinces, hold festivals, chat, and climb the ranking.
8. Hold six of the ten provinces to be proclaimed Hegemon of Kansai — after which the world carries on.

## Run it locally

Requirements: Node.js 20+ and PostgreSQL 14+.

```bash
docker compose up -d          # or point DATABASE_URL at any PostgreSQL
cp .env.example .env.local
npm install
npm run db:migrate
npm run dev
```

Open http://localhost:3000. The world is created on the first request.

`WORLD_SPEED` sets how fast the world runs. `1` is real time (one tick per hour, as in the design document). The example file uses `60`, a test world where a game hour passes every real minute, so the whole loop can be played in a sitting.

While someone has the game open, the world advances on its own. To keep timers firing to the second with nobody connected, also run the worker:

```bash
npm run worker
```

## Deploy to Vercel

1. Push this repository to GitHub and import it in Vercel (framework preset: Next.js, no other settings).
2. Add a PostgreSQL database: Vercel dashboard → Storage → Neon (or any PostgreSQL). It must expose `DATABASE_URL`.
3. Add environment variables: `WORLD_SPEED` (`60` for a test world, `1` for real time) and `CRON_SECRET` (any long random string).
4. Deploy. The build runs the database migrations (`npm run build` → `scripts/migrate.ts`), and the first request creates the world.

**Keeping the world moving on Vercel.** There is no long-lived worker on serverless hosting, so the simulation is driven three ways, all running the same engine:

- every API request first brings the world up to the present (players online keep it current);
- `/api/cron/advance` processes everything that is due — `vercel.json` schedules it once a day, which every Vercel plan allows; on Pro you can change the schedule to `* * * * *`, or point any external scheduler at it every minute with the header `Authorization: Bearer <CRON_SECRET>`;
- if nobody was online and no cron ran, the next request replays the missed time step by step.

Because the engine works from stored timestamps, all three produce exactly the same world.

## Tests

```bash
npm test                      # unit tests: battle engine, rules, map (no database needed)
TEST_DATABASE_URL=postgres://aoteru:aoteru@127.0.0.1:5432/aoteru_test npm run test:integration
```

The integration suite drops and recreates the `public` schema of the test database, then plays the whole first-playable journey against real PostgreSQL with a virtual clock: founding without ownership conflicts, validated building and recruitment, exactly-once ticks, marching, a reproducible battle and conquest, a second player, war and peace, scouting, a clan falling and rising again, a day of offline simulation with NPC turns, and the HTTP layer (sessions, CSRF, idempotent replay).

## How it is built

A modular monolith in one Next.js application.

```
src/game/      Rules shared by server and client: resources, buildings, units, formulas,
               the Five Pillars, the Kansai map, the battle engine, the API contract.
               Pure data and pure functions — no I/O.
src/server/    The game server. One module per domain:
               auth · clans · territory · economy · buildings · progression (Five Pillars)
               military · armies · battles · diplomacy · espionage · npc · tick · advance
               notify (notifications, realtime outbox, chronicle, audit) · views (read models)
src/app/api/   Thin HTTP routes over the server modules (the REST API of GDD §15).
src/app/       The web client: landing, auth, clan creation and the game screens.
src/components/, src/lib/   Client components, map, state and polling.
db/migrations/ SQL migrations.          scripts/   migrate.ts, worker.ts
tests/         unit/ and integration/
```

### The server is the single source of truth

- The client sends intent only (what to build, how many to recruit, where to march). Costs, timers, production, battle results and ownership are computed by the server from its own state.
- Every state-changing transaction holds the **world lock** (a PostgreSQL advisory lock). The world is a single-writer system: a tick cannot run twice at once and a player order cannot interleave with a battle being resolved.
- Spending is one atomic conditional `UPDATE`, backed by `CHECK (… >= 0)` constraints, and every balance change is written to an immutable ledger (`transactions`).
- Troops leave a garrison through conditional updates, so the same soldiers cannot be sent twice.
- Province ownership is written in exactly one function, which records every change in `province_ownership_history`.
- Mutations accept an `Idempotency-Key`; a retried request gets the stored answer instead of running twice.
- Sessions are opaque tokens in an httpOnly, SameSite=Lax cookie (only a hash is stored); passwords are hashed with scrypt; mutations are origin-checked and rate-limited in the database.
- Important actions are appended to `audit_logs`.

### The simulation engine

`src/server/advance.ts` runs the world as a discrete-event simulation over stored timestamps. Each step takes the earliest thing that is due — a building finishing, a muster completing, an army arriving, a battle or scouting mission coming due, or the next hourly tick — and processes it *at the time it was due*, in its own transaction.

- **Idempotent, no duplicate ticks:** each tick inserts its row in `world_ticks` first; the primary key refuses a second run.
- **Retryable:** a failed step rolls back completely and is retried on the next pass; the error is recorded in `world_state.last_error` and shown by `/api/health`.
- **Offline progress:** the world tick does production, population food, army upkeep, starvation, experience; once a game day population growth, loyalty and rebellion; twice a day a seeded world event; then the NPC daimyo take their turns.

### Battles

`simulateBattle(inputs, seed)` in `src/game/battle.ts` is a pure function. When a battle comes due the server snapshots the inputs — both armies, commander bonuses from the Five Pillars, morale, terrain, weather, castle level and the combat rules in force — stores them with a server-generated seed, and only then applies the result. The battle row is locked and must still be pending, and `battle_reports` has one row per battle, so casualties are applied exactly once. `GET /api/battles/:id` re-runs the stored battle and reports whether it reproduces.

### Realtime

Events are written to an outbox (`realtime_events`) addressed to the shared `world` room or one player's private room, using the event names of GDD §16 (`world:province_updated`, `resource:updated`, `battle:started`, `battle:completed`, `notification:new`, `chat:message`, …). The client receives them by polling `GET /api/sync`, which only ever returns the rooms that player may hear.

## Differences from the design document's recommended stack

The document recommends NestJS, Redis, BullMQ and Socket.IO. Those need long-running processes, which Vercel does not host, so this prototype keeps the document's architecture — modular monolith, PostgreSQL, server authority, idempotent timestamp-driven ticks, worker-style processing, room-scoped realtime events — on infrastructure that deploys to Vercel as a single project:

| Design document | Prototype | Moving to the recommended stack later |
|---|---|---|
| NestJS API | Next.js route handlers over `src/server/*` | The server modules do not depend on Next.js; wrap them in NestJS controllers. |
| BullMQ workers | `advanceWorld()` driven by requests, cron, or `npm run worker` | Call the same function from BullMQ jobs. |
| Socket.IO | Outbox + polling (`/api/sync`) | Publish the outbox rows over Socket.IO rooms with the same event names. |
| Redis cache | Not needed at this scale; static world data lives in code | Add where load testing shows the need. |

## Not in the prototype yet

Alliances, trade pacts, vassals, generals, research and technology, the Blacksmith, Academy and Watchtower, Ninja and siege units, sabotage, password recovery, an admin dashboard, and the other six regions. The data model and module boundaries leave room for them; none of them is stubbed in the interface.

Operational items from the backlog that are a matter of hosting rather than code — automated backups with point-in-time recovery, error monitoring, load testing — still have to be set up for a production world.

## Tuning

Balance lives in `src/game/config.ts` (resources, buildings, units, world constants), `src/game/pillars.ts` (pillars and skills), `src/game/battle.ts` (`currentBattleRules`) and `src/game/map.ts` (provinces, garrisons, NPC clans). Old battles keep the rules they were fought under.
