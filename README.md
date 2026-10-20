# PairSpace

Real-time collaborative code editor, built as a learning project in distributed systems:
multiple people edit one document at the same time over an unreliable network.

- `idea.md`: what we're building and why
- `context.md`: reasoning so far, concepts, and the decision log

## Status

Early. A WebSocket relay server with rooms exists. The editor, Yjs sync, persistence and reconnect do not yet.

## Run it

Requires Node 24 or newer (`nvm use` reads `.nvmrc`).

```
cd server
npm install
npm run dev          # relay on ws://localhost:8080 (restarts on change)
npm test             # automated tests (Vitest); npm run test:watch to keep running
npm run typecheck    # TypeScript check
npm run format       # Biome: fix lint + formatting
npm run build        # compile to dist/
npm start            # run the compiled server
```

`web/test.html` is a bare manual test page: open it in two tabs using the same `#room` in the URL.
