# CALMLING

**One Calmling. One life. The whole world watching.**

One autonomous animated character living a persistent life on a small island,
24/7. Everyone watches the same Calmling. Viewers can chat, send gifts, vote
and build things together. They influence the world. They cannot control the
character.

> The character is the official Calmling artwork (`apps/web/public/assets/calmling/calmling.png`),
> animated procedurally (breathing, squash, tilt, blinking eyelids). Hand-made
> animation clips can replace this through the asset system. See [docs/ASSETS.md](docs/ASSETS.md).

**Design rule: everything must be calming.** No urgency, countdowns, flashing, loud
counters or leaderboards; slow motion; muted colours; quiet sound; chat slow mode;
Calmling is never distressed. New features should pass that test.

## Architecture

```
packages/core   @calmling/core: the deterministic simulation (pure TypeScript, no I/O)
                world, needs, action library, validator + planner, habit engine,
                memory, personality, utility brain, LLM prompt/parse, chat moderation,
                diary writer, highlight scoring, animation state machine, wire protocol
apps/worker     @calmling/worker: the persistent simulation service (Node)
                tick loop, transactional checkpoints, durable inboxes (gifts/goals/polls),
                OpenAI client with cost controls, HTTP API, WebSocket fan-out, admin
apps/web        @calmling/web: Next.js + React + Tailwind + Framer Motion + Zustand
                Phaser 3 renderer behind a renderer interface
db/migrations   PostgreSQL schema (runs on Supabase, managed Postgres and embedded PGlite)
db/supabase     row-level security policies (Supabase only)
e2e             Playwright tests
```

- **Server-authoritative.** Only the worker changes character or world state. The website never touches the database. Browsers receive a `hello` snapshot, then sequenced `delta`s, plus a full snapshot every 30 s. On a sequence gap the client asks to resync.
- **Brains propose, the engine decides.** Every tick, `generateCandidates()` lists only valid actions with their targets. The LLM, if configured, picks one of those candidates. `validateProposal()` re-checks it: existence, discovered, reachability, tools, energy, time of day. It then expands it into a plan, for example walk → pick up watering can → walk → water. An invalid proposal is logged and replaced with a safe deterministic alternative.
- **Crash-safe.** Every tick commits events, memories, habits, objects, decisions and the full state snapshot in one transaction. A restart resumes from the last committed tick.
- **Viewer text is untrusted.** Chat is moderated, injection-flagged, sanitised and summarised into themes. It is then placed in a delimited data block. The LLM can only ever pick from the validated candidate list, whatever the chat says.

## Local setup

Requirements: Node 20+ (22 recommended). Postgres and Redis are optional.

```bash
npm install
```

```bash
npm run dev
```

- Website: http://localhost:3000 · Simulation API/WebSocket: http://localhost:4000
- With no `DATABASE_URL` the worker uses **embedded PGlite** (real Postgres compiled to WASM) at `apps/worker/.data/pglite`. Data persists across restarts. Delete that folder to start a new life.
- Admin: http://localhost:3000/admin with token `dev-admin`. Change `ADMIN_TOKEN` and `AUTH_SECRET` for anything public. The worker refuses to start in production with the defaults.

Copy `.env.example` to `.env` for configuration (the worker reads env vars, e.g. `set -a; . ./.env; set +a; npm run dev`).

Using real Postgres + Redis:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/calmling REDIS_URL=redis://localhost:6379 npm run dev:worker
```

## Testing

```bash
npm test
```

```bash
TEST_DATABASE_URL=postgres://postgres@localhost:5432/calmling_test TEST_REDIS_URL=redis://localhost:6379 npm test
```

```bash
npm run test:e2e
```

The first command runs unit, simulation and integration tests (34; one is skipped without `TEST_DATABASE_URL`). The second also runs the real PostgreSQL + Redis test. The third runs Playwright: it starts a fresh worker on :4000 and Next on :3000.

### Testing autonomous behaviour

- `npm run simulate -- --days 14 --seed 7` runs two simulated weeks offline in under a second. It prints activity counts, formed habits with the evidence behind them, personality trends, important memories and the last diary entry. Different seeds give different lives.
- In the running app: **Admin → Fast-forward** (e.g. 7 days) runs the real service at full speed with the deterministic brain, committing every 2 simulated hours and writing diaries. **Admin → Speed** changes the live time scale. The Decisions tab shows each choice with its candidates, scores and reason. The Habits tab shows the occurrences that formed each habit.
- Restart test: stop the worker (Ctrl-C) and start it again. It logs `resumed: day N, tick T`, and connected browsers reconnect automatically.

## Deployment

- **Website → Vercel.** Project root `apps/web`, install command `npm install` at the repository root. Set `WORKER_URL` (server-side rewrites) and `NEXT_PUBLIC_WS_URL` (e.g. `wss://sim.example.com/ws`).
- **Simulation → a persistent host** (Railway, Fly.io, Render, ECS, a VM). Not serverless. Use `apps/worker/Dockerfile` (build from the repo root). Run exactly **one** instance: it is the single authoritative writer. Set `DATABASE_URL`, `AUTH_SECRET`, `ADMIN_TOKEN`, `CORS_ORIGINS` and optionally `REDIS_URL` and `OPENAI_API_KEY`. Health check: `GET /health` (503 if the loop stalls).
- **Database → Supabase / managed Postgres.** The worker applies `db/migrations` automatically on start (`npm run migrate` to run alone). On Supabase, also apply `db/supabase/002_rls.sql` in the SQL editor.
- **Redis → any managed Redis** (Upstash, ElastiCache…). Used for rate limiting and a `calmling:stream` pub/sub channel for future gateway instances.

## Required credentials

| Variable | Needed for | Without it |
|---|---|---|
| `AUTH_SECRET`, `ADMIN_TOKEN` | production | dev defaults (rejected when `NODE_ENV=production`) |
| `DATABASE_URL` | production persistence | embedded PGlite (local only) |
| `OPENAI_API_KEY` | LLM decisions + LLM diary | deterministic utility brain + template diary, clearly labelled in the UI |
| `REDIS_URL` | multi-instance rate limits | in-memory limiter |

## Status: what is and isn't done

**Fully implemented and tested**
- Persistent world with 5 locations, day/night, weather, plants that need water, grow and bloom, regrowing apples, and persistent objects and furniture positions.
- 8 needs and 7 traits with measured trait history. Trend statements appear only when the stored history supports them.
- 28 actions with validation, tool fetching, carrying and placing, interruption, and failure that affects confidence.
- Habit engine (context, object and sequence habits) with evidence, strength, decay, fading and dissolving. Nothing is pre-scripted.
- Five memory types, all grounded in event ids, with retrieval and daily consolidation.
- Deterministic utility brain. OpenAI brain with JSON-schema output, candidate binding, hourly and daily cost limits, back-off and deterministic fallback (tested against a mock OpenAI server).
- Gifts end to end: validation, rate limits, durable inbox, object creation, discovery by perception radius, social memory, interaction tracking, and profile facts like "Calmling has read it 3 times… it is beside the bed".
- Chat with moderation, links and spam blocking, injection flags, burst and minute rate limits, duplicate detection, reactions, reports (auto-hide at 3), block, local mute, admin hide and mute. Chat observations are summarised for the brain.
- Community goals with daily per-user caps and transactional completion that permanently adds a world object. Polls with one vote per user, a daily poll created automatically, and the outcome spawned into the world.
- Diary from verified events (template, or LLM when configured), with the source events listed. Highlights scored on 6 axes, with replay frames and an exportable clip manifest.
- Admin: pause/resume, speed, fast-forward, state, decisions with reasons, habits with evidence, memory, observations, personality, event log, world objects (remove gifts), chat moderation, goal and poll creation, highlight review, errors, audit log, API spend.
- Real-time shared world: one simulation, sequenced deltas, gap resync, periodic snapshots, late join, auto-reconnect with back-off, and client interpolation of walking.
- All routes: `/ /world /memories /diary /community /gifts /profile /about /admin /highlights`.

**Partially implemented**
- Authentication is a development login: claim a username, get an HMAC token. Supabase Auth is not integrated.
- Character animation uses one official still with procedural motion. Per-clip sprite sheets load from the manifest, but swapping them in for the still is not wired (see docs/ASSETS.md).
- Ambient soundscape is procedural Web Audio (breeze, rain, crickets, rare birds). Real recorded ambience would sound better.
- Weekly and monthly recaps: daily entries only so far. Personality summaries appear in admin, not as diary entries.
- Redis pub/sub is published, but no separate gateway consumes it yet. One worker instance serves WebSockets.
- Supabase RLS policies are written but have only been tested as SQL syntax, not against a Supabase project.

**Not implemented**
- Video capture or rendering of clips, and any automatic social posting. The manifest exists; no clips are claimed.
- A 24/7 encoded video broadcast adapter. The live view is in-browser rendering of shared state, not a video stream.
- Payments (intentionally out of scope for the MVP).
- Live OpenAI testing. Only a mock endpoint was exercised, because no API key was available.
