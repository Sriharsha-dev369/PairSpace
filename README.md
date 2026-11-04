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

Phase 1 milestones M1 to M10 are done, M11 (deploy) in progress. Rooms you share by link, where several people edit
the same files live with names and cursors; it survives drops, offline spells and bad networks, and saves
every change to Postgres. Accounts by email and password or GitHub; invited guests join by link with a
name. Multi-file projects, Run (JavaScript and Python, in the browser), edit or view-only links, session
replay, and a sync inspector with a simulated bad network. Works on phones; every page passes automated
accessibility checks (WCAG 2.1 AA).

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

On Render (one always-on web service, from `render.yaml`) with Neon's free Postgres and Sentry for
errors. The steps only a person can do (accounts, secrets, the GitHub OAuth App) are a guided script:

```
bash scripts/deploy-wizard.sh
```

Then `.github/workflows/smoke.yml` checks the site every day (set the `PRODUCTION_URL` repository
variable; the wizard does), or by hand: `BASE_URL=https://… npx playwright test e2e/smoke.spec.ts --project chromium`.
