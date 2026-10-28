# PairSpace: Phase 1 (MVP) Roadmap

Scope and goals: `context.md`. This file orders the work. Near milestones are detailed, later ones are sketches and will be refined when we reach them. Sizes: S = days, M = about a week, L = more than a week.

## Order and why

Build the riskiest, most central thing first (real-time editing), then make it durable, then add identity, then features on top, then polish and ship.

```
M0 Relay ✅ ─► M1 Co-editing ─► M2 Reliability ─► M3 Persistence + DB ─► M4 Auth ─► M5 Dashboard + share roles
                                                          │                                   │
                                                          └──► M8 Replay                      └──► M6 Multi-file ─► M7 Run
                                    M9 Sync inspector (needs M2) ─────────────────────────────────┘
                                                                         M10 Landing + polish ─► M11 Harden + deploy
```

| # | Milestone | Size | Status |
|---|---|---|---|
| M0 | Relay server with rooms, tests, tooling | S | ✅ done |
| M1 | Real-time co-editing (single file, anonymous) | L | ✅ done |
| M2 | Reliability: heartbeats, reconnect, offline edits | M | in progress (heartbeats, size limit, fault-injection tests done; reconnect UX left) |
| M3 | Persistence and database | L | |
| M4 | Accounts (email + GitHub) | M | |
| M5 | Dashboard and share links with roles | M | |
| M6 | Multi-file projects | L | |
| M7 | In-browser Run (JS + Python) | M | |
| M8 | Session replay | M | |
| M9 | Sync inspector and bad-network toggle | M | |
| M10 | Landing page and polish | M | |
| M11 | Hardening and deploy | M | |

## Milestones

### M1: Real-time co-editing
Vite + React + TypeScript frontend, a code editor, Yjs documents synced over the relay. Two browsers on one room link edit the same file, with remote cursors, names and colours, and a connection-status indicator. The room data model is "a set of files" from the start, but only one file is used.
- **Done when:** two tabs co-edit live; an automated test has two Yjs clients converge through the relay, including simultaneous edits.
- **Decisions to bring:** editor component (CodeMirror 6 vs Monaco); `y-websocket`'s ready-made server vs our own relay; UI kit (Tailwind + a component library, chosen now so the product never looks raw).

### M2: Reliability
Heartbeats (no ghost users), automatic reconnect with resync of only what was missed, edits made offline merge cleanly on return, a clear "reconnecting" state in the UI.
- **Done when:** a test using a fault-injecting proxy (delay, drop, disconnect) shows both documents end up identical.

### M3: Persistence and database
Postgres (decision to confirm). Rooms and files stored; the Yjs state is saved and reloaded on first join, empty rooms are unloaded, writes are batched, and a server restart loses nothing. **Every update is stored with author and timestamp**, because replay (M8) depends on the history surviving any compaction.
- **Done when:** restart the server mid-session and the document is intact; tests cover save, load, and unload.
- **Decisions to bring:** database (recommendation: Postgres) and ORM/migration tool.

### M4: Accounts
Email and GitHub sign-in through an existing auth library (not hand-rolled). Sessions, and WebSocket connections that know who is connecting.
- **Done when:** sign up, sign in and sign out work; an unauthenticated WebSocket cannot join a protected room.
- **Decisions to bring:** auth library; whether people with an invite link can join as guests (recommendation: yes, with a display name, so the first click has no signup wall).

### M5: Dashboard and share links with roles
Dashboard (my rooms, recent, create, rename, delete). Share links as *editor* or *view-only*, revocable. The server enforces roles: a view-only connection's edits are rejected.
- **Done when:** permission tests pass for owner, editor, view-only and revoked link.

### M6: Multi-file projects
File tree and tabs; create, rename, delete; language chosen by file extension; many documents per room saved and loaded. Resolve the edit-vs-delete/rename conflict deliberately.
- **Done when:** two people work in different files at once; one deleting a file another is editing ends in a defined, tested, non-corrupting outcome.

### M7: In-browser Run
Run JavaScript (sandboxed Worker/iframe) and Python (Pyodide) with a timeout that kills infinite loops. Output is shared with the whole room. Run respects roles.
- **Done when:** a run by one person shows output for all; a `while(true)` is stopped cleanly.

### M8: Session replay
A slider that replays the session from the stored update history, with a colour per person.
- **Done when:** scrubbing to time *t* shows exactly the document as it was at *t*; tested against known edit sequences.

### M9: Sync inspector and bad-network toggle
Live panel: round-trip latency, pending updates, connection state, last sync. A toggle that injects delay or goes offline in the client transport so a visitor can watch both editors still converge. Metrics are collected in a form Phase 2 benchmarks can reuse.

### M10: Landing page and polish
Landing page with an animated live demo, a design pass over every page, empty/loading/error states, responsive layout, fast first load, basic accessibility. The goal: someone clicking an invite link is amazed.

### M11: Hardening and deploy
End-to-end tests of the key flows (browser-driven, automated), error handling, environment configuration, hosting decision, TLS, a post-deploy smoke test. Then Phase 1 is done and Phase 2 starts.

## Rules for this roadmap
- Each milestone ends with something that runs end to end and has tests.
- Only M1 and M2 are planned in detail. The rest are refined when we reach them, and may be reordered if something we learn requires it.
- Scope changes go through a decision-log row in `context.md`.
