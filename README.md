# PairSpace

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

Early. A WebSocket relay server with rooms exists. The editor, Yjs sync, persistence and reconnect do not yet.

## Run it

Requires Node 24 or newer (`nvm use` reads `.nvmrc`).

npm workspaces: `server/` (WebSocket server) and `web/` (Vite + React app). Run everything from the repo root.

```
npm install
npm run dev -w server   # server on ws://localhost:8080 (restarts on change)
npm run dev -w web      # web app on http://localhost:5173
npm test                # all automated tests (Vitest)
npm run typecheck       # TypeScript check, all packages
npm run lint            # Biome check; npm run format to fix
npm run build -w server && npm start -w server   # compiled server
```
