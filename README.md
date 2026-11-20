# Aoteru: Rise of Japan

*Unite the Clans. Master the Art of War. Conquer Japan. Become Shogun.*

A persistent, server-authoritative, **clan-based** multiplayer grand strategy game set in Sengoku-era Japan. Players found clans or join them; a clan — not a single player — owns provinces, a treasury and armies, and its members plan wars together. This repository is the **first playable prototype** of that design (change request v2.0, §16): one region (Kansai), ten provinces, clans of several players beside two NPC houses, all six resources, five buildings, the Five Pillars, five unit types, a War Council with eleven strategies and their counters, treaties, and the complete loop from founding or joining a clan to taking a neighbouring province with a plan the clan made together — in a shared world that keeps running while everyone is offline.

The defining principle: *the strongest clan does not always win; the smartest clan does.*

| Japan map (desktop) | Province sheet (phone) |
|---|---|
| ![The Kansai map with a province selected](docs/screenshots/map-desktop.jpg) | ![Province detail as a bottom sheet on a phone](docs/screenshots/province-sheet-mobile.jpg) |

More in [`docs/screenshots`](docs/screenshots): overview, castle, Five Pillars and a battle report.

## What you can do in the prototype

1. Register. You have a purse, a residence and Five Pillars of your own from the first minute.
2. Found a clan on a starting province (name, tag, banner, recruitment setting) — or discover a clan and join it: walk into an open one, apply, or accept an invitation.
3. Serve in a role: Shogun, Daimyo, General, Strategist, Intelligence Officer, Treasurer, Samurai or Recruit. The leader decides what each role may do.
4. Pay into the shared treasury; the treasurer can pay members out of it. Every movement is logged with the member who made it.
5. Build the clan's Castle, Farm, Market, Barracks and Dojo, recruit Ashigaru, Yari, Archers, Samurai and Cavalry, and feed the population and the army from the treasury.
6. Level your own Five Pillars. Each pillar of the clan is carried by the member holding its council seat, so a clan of specialists is stronger than one player mastering everything.
7. Scout a neighbour: the report shows its garrison and the stance it is held in.
8. In the War Council, draft a plan — target, host, tactic, commander — give members duties, and launch it when the clan is ready. Tactics can be countered; a wrong guess costs the battle.
9. Order the stance of your own provinces: watch for night raids, hold the walls, lie in ambush, keep a reserve, lay in stores.
10. Declare war, make peace, sign a non-aggression pact or an alliance — and pay for it in loyalty if you break your word.
11. Talk in the world channel, in your clan's channel, or privately with any player.
12. Read a round-by-round battle report that says how the tactic fared against the stance, and re-runs the stored battle to prove it.

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

The integration suite drops and recreates the `public` schema of the test database, then plays the game against real PostgreSQL with a virtual clock: founding without ownership conflicts, validated building and recruitment, exactly-once ticks, marching, a reproducible battle and conquest, war and peace, scouting, a clan falling and rising again, a day of offline simulation with NPC turns; then the clan systems — applying, invitations, roles and permissions enforced on every order, treasury deposits and withdrawals in both ledgers, council seats, clan chat and private messages kept to their readers, handing over leadership, dissolving a clan — a war plan drafted by a strategist, launched by its commander and fought with the chosen tactic, stances that take time to prepare, treaties and the price of breaking them, doctrines; and the HTTP layer (sessions, CSRF, idempotent replay). Unit tests cover the battle engine, the strategy matrix (every tactic has exactly one counter, no stance stops everything) and the rules.

## How it is built

A modular monolith in one Next.js application.

```
src/game/      Rules shared by server and client: resources, buildings, units, formulas,
               the Five Pillars, clan roles and permissions (clan.ts), tactics, stances and
               their resolution (strategy.ts), the Kansai map, the battle engine, the API contract.
               Pure data and pure functions — no I/O.
src/server/    The game server. One module per domain:
               auth · clans · members (roles, permissions, joining) · purse (personal economy,
               treasury deposits and withdrawals) · territory · economy · buildings
               progression (Five Pillars, council seats) · military · armies · battles
               stance · warcouncil + warplans (plans, duties, launch) · diplomacy · pacts
               espionage · chat · npc · tick · advance
               notify (notifications, realtime outbox, chronicle, audit, clan history)
               views · clanviews · warviews (read models)
src/app/api/   Thin HTTP routes over the server modules (the REST API of GDD §15).
src/app/       The web client: landing, auth, clan creation and the game screens.
src/components/, src/lib/   Client components, map, state and polling.
db/migrations/ SQL migrations.          scripts/   migrate.ts, worker.ts
tests/         unit/ and integration/
```

### Clans, roles and the council

- Membership, roles and permissions live in the database (`clan_members`, `clan_role_permissions`). Every order runs inside one transaction that re-reads and locks the member's row and the clan's, then checks the permission the order needs — a member demoted a moment ago cannot slip an order through on a stale session.
- The Five Pillars belong to the player. Each pillar of the clan is carried by the strongest of the leader and the member in the matching council seat (General → Military, Treasurer → Economy, Intelligence Officer → Intelligence, Daimyo → Culture, Shogun → Leadership); the member who leads an army fights with their own Military pillar.
- The treasury is the clan's; every player also has a purse. A deposit or a withdrawal moves both balances in the same transaction and writes both ledgers, with the member who made it.
- Chat has three channels with different readers: the world, a clan's members, and the two players of a private thread. Realtime events are written to the room allowed to read them (`world`, `clan:<id>`, `player:<id>`).

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

### Strategy

`src/game/strategy.ts` defines six tactics and six stances. Each tactic has a requirement, a cost, a chance to fail and exactly one stance that defeats it; each stance has a price and defeats at most one tactic. An ambush is defeated by nothing in the field — only by scouting it first. When a battle comes due the server resolves tactic against stance with the battle's seed (`resolveStrategy`), folds the result into both sides' modifiers, morale and the defender's hold on their walls, and stores the whole resolution in the battle inputs: the report can say what happened and why, and the replay still matches.

A war plan adds what the clan's teamwork is worth: an accepted strategist and a scout who has actually scouted the target raise the tactic's chance, a logistics officer cuts the supplies, reserves standing by lift morale.

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

From the change request: clan technology and research, province governors and defensive commanders, trade pacts and vassals, multi-clan alliances with joint operations, false armies and misinformation, psychological warfare and political manipulation, supply lines on the map, the Shogunate, seasonal events, generals as characters, Ninja and siege units, sabotage, password recovery, an admin dashboard, and the other six regions. The data model and module boundaries leave room for them; none of them is stubbed in the interface.

Operational items that are a matter of hosting rather than code — automated backups with point-in-time recovery, error monitoring, load testing — still have to be set up for a production world.

## Tuning

Balance lives in `src/game/config.ts` (resources, buildings, units, world constants), `src/game/pillars.ts` (pillars and skills), `src/game/strategy.ts` (tactics, stances and what each is worth), `src/game/clan.ts` (roles, default permissions, doctrines, the personal economy), `src/game/battle.ts` (`currentBattleRules`) and `src/game/map.ts` (provinces, garrisons, NPC clans). Old battles keep the rules they were fought under.
