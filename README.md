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

M1 and M2 done: open the web app, share the room link, and edit one file together live with names and cursors; it survives drops, offline spells and bad networks. M3 done: rooms are saved to Postgres (every change, with who made it and when) and survive a server restart. M4 done: sign up with email and password or GitHub; members create rooms, invited guests join by link. Not deployed.

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
