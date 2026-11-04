# PairSpace

[![CI](https://github.com/Sriharsha-dev369/PairSpace/actions/workflows/ci.yml/badge.svg)](https://github.com/Sriharsha-dev369/PairSpace/actions/workflows/ci.yml)

Real-time collaborative code editor, built as a learning project in distributed systems:
multiple people edit one document at the same time over an unreliable network.

- `idea.md`: what we're building and why
- `context.md`: reasoning so far, concepts, and the decision log
- `ROADMAP.md`: Phase 1 milestones in order

## Goals

A full-stack collaborative editor (frontend, backend, auth, database) with a distributed-systems core.
Phase 1: a complete, polished MVP. Phase 2: production-ready, with benchmarks for latency, scaling,
delayed networks and concurrent changes.

## Status

Milestones M1 to M10 are done, M11 (deploy) in progress. Rooms you share by link, where several people edit
the same files live with names and cursors; it survives drops, offline spells and bad networks, and saves
every change to Postgres. Accounts by email and password or GitHub; invited guests join by link with a
name. Multi-file projects, Run (JavaScript and Python, in the browser), edit or view-only links, session
replay, and a sync inspector with a simulated bad network. Works on phones; every page passes automated
accessibility checks (WCAG 2.1 AA).

## How every copy stays identical, and the proof

Each person edits their own copy of the room, and the server only relays and saves changes, so typing
never waits for the network. The copies are [Yjs](https://yjs.dev) CRDT documents: every inserted
character gets a unique id (the author's client id and a counter) and is placed relative to its
neighbours, so concurrent edits merge in the same order on every copy with no central lock, and
applying a change twice or late changes nothing. After a reconnect, each side sends a summary of what it
has (a state vector) and receives only what it's missing, which is how offline typing merges back in.
The relay is my own WebSocket server (`server/src/sync-server.ts`): heartbeats, reconnects, an
append-only change log in Postgres.

**The experiment** (`server/test/convergence.ts`): three clients edit one room on the real sync server,
each through its own fault-injection TCP proxy (`server/test/faulty-network.ts`), making 60 edits at
random positions per run. Every run is done twice with the same seeded edits:

- **clean**: no faults
- **faulty**: 10-50 ms delay each way, a connection reset every 10 edits, and one client offline for
  20 of the 60 edits (it keeps typing, and merges when it's back)

A run passes when all three copies have the same text and the same state vector, and every character
typed is there. *Settle* is the time from the last edit until all three copies match.

```
npm run convergence            # 100 runs per network, ~2.5 minutes, no database needed
npm run convergence -- 500     # any number of runs; run i always uses seed i
```

Results on 2026-11-04 (Apple M5, everything on one machine):

| Network | Runs converged | Characters lost | Connections dropped | Settle median | p95 | max |
|---|---|---|---|---|---|---|
| clean | 100/100 | 0 of 11,920 | 0 | <1 ms | 3 ms | 3 ms |
| faulty | 100/100 | 0 of 11,920 | 440 (4.4 per run) | 303 ms | 508 ms | 547 ms |

What the numbers mean:
- Everything runs on one machine, so settle times measure merging and reconnecting, not distance on
  the internet.
- Most of the faulty settle time is the client's reconnect wait. It uses y-websocket's own timing, as
  the app does: the first retry comes after 200 ms.
- Times vary by a few percent between runs. Convergence and loss don't.
- CI reruns the experiment on every push, with 20 runs per network, and fails if any run doesn't
  converge or loses anything.
- The sync server's own tests (`npm test -w server`, "unreliable network") cover catch-up, offline
  merges, slow links, and a chaos run with a fresh random seed each time.

## Run it

Requires Node 24 or newer (`nvm use` reads `.nvmrc`) and Docker (for Postgres).

npm workspaces: `server/` (WebSocket server) and `web/` (Vite + React app). Run everything from the repo root.

```
npm install
cp .env.example .env    # optional: GitHub sign-in needs an OAuth App's id and secret (see the file)
npm run db:up           # Postgres in Docker on localhost:5433 (npm run db:down to stop)
npm run dev -w server   # server on ws://localhost:8080 (restarts on change)
npm run dev -w web      # web app on http://localhost:5173 (sign up there to start a room)
npm test                # all automated tests (Vitest; server tests need db:up)
npm run typecheck       # TypeScript check, all packages
npm run lint            # Biome check; npm run format to fix
npm run test:e2e        # browser tests (Playwright; first time: npx playwright install chromium)
npm run build           # production build, all packages
npm run build -w server && npm start -w server   # compiled server
```

CI (GitHub Actions, `.github/workflows/ci.yml`) runs the same checks on every push to `main` and every pull request.

## Deploy it

Free: Render's free web service (from `render.yaml`; it sleeps after 15 minutes without visitors and
takes ~30-60 s to wake), Neon's free Postgres, and Sentry's free plan for errors. The steps only a person can do (accounts, secrets, the GitHub OAuth App) are a guided script:

```
bash scripts/deploy-wizard.sh
```

Then `.github/workflows/smoke.yml` checks the site every day (set the `PRODUCTION_URL` repository
variable; the wizard does), or by hand: `BASE_URL=https://… npx playwright test e2e/smoke.spec.ts --project chromium`.
