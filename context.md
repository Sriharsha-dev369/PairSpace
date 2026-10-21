# PairSpace: Context (state of thinking so far)

How the three files relate:

| File | Purpose |
|---|---|
| `idea.md` | *What* we're building (source of truth for the product) |
| `CLAUDE.md` | Working instructions for Claude (commands, stack, workflow). Local only: it is in `.gitignore` |
| `context.md` (this file) | *Where we are*: what was reasoned, decided and learned, and what's next |

Status: M1 done (live co-editing, presence, cursors, tested end to end). Not deployed. Next: M2 reliability. Last updated 2026-10-21.

---

## Project goals

PairSpace is a **full-stack project with a distributed-systems core**, built in two phases.

| | Phase 1: MVP | Phase 2: Distributed systems |
|---|---|---|
| **What** | The complete full-stack working model: frontend, backend, auth, database, and the real-time collaborative editor, everything working end to end. Learning-specific | Make it production-ready and battle-tested |
| **Bar** | When someone clicks the invite link, they should be **amazed**: it feels polished and instant, not like a demo | **Benchmarks we can show on a resume**, backed by real measurements |
| **Includes** | Rooms and invite links, in-browser code execution, live shared editing, cursors/presence, accounts (auth), saved documents (database), UI quality | Benchmarks for latency, scaling, delayed/unreliable networks, and concurrent changes; **server-side code execution** through an existing sandbox engine (e.g. Judge0 or Piston; check availability and terms), benchmarked for queue latency, concurrent executions and timeouts (and more as questions arise, e.g. reconnect recovery, persistence durability) |
| **Deploy** | **When the MVP is built** (not before) | Hardening and load testing against the deployed system |

### MVP scope: final product view (decided 2026-10-20)

```
Landing ──► Sign in ──► Dashboard ──► Room (editor + side panels)
```

| Page / feature | Details |
|---|---|
| **Landing** | Pitch, "Create a room", animated live demo; the "amazed" first impression |
| **Auth** | Email and GitHub sign-in; users and sessions in the database |
| **Dashboard** | My rooms and recent rooms; create, rename, delete, join by link |
| **Room (editor)** | Live co-editing, cursors, who's online, connection status, language picker, auto-save |
| **Multi-file projects** | A room holds many files: file tree, tabs, create / rename / delete. Data model is "a room has many files" from day one; build one file first, then the tree. New concurrency case: one person edits a file while another deletes or renames it |
| **In-browser Run** | A Run button for JavaScript (sandboxed Web Worker/iframe) and Python (Pyodide, Python compiled to run in the browser). One person presses Run, and the output panel is shared with everyone in the room. The browser sandbox keeps our servers safe |
| **Share-link roles** | Invite as editor or view-only; revoke the link. Enforced on every WebSocket connection |
| **Session replay** | Time-travel slider replaying how the code was written, colour per person. Built on the saved edit history |
| **Sync inspector + bad-network toggle** | Live panel: latency, pending updates, connection state; a switch to add delay or go offline and watch both editors still converge. Feeds the Phase 2 benchmarks |

**Out of scope for the MVP:** video chat, text chat, server-side code execution (moves to Phase 2). If video is wanted after Phase 1, use an existing hosted video/voice component instead of building WebRTC ourselves. May be revisited after the MVP.

The line between phases: Phase 1 proves it works; Phase 2 proves it holds up, with numbers.

---

## 1. The project in brief

Real-time collaborative code editor. Two (later N) people join a room via a shareable link, edit the same file, see each other's cursors/presence, survive disconnects, and don't lose work.

- It is a **distributed systems project in disguise**: several machines hold copies of the same data over an unreliable network, and must stay consistent through delay, loss and failure.
- The product is a vehicle. The point is learning the backend engineering by building, breaking, measuring and optimizing.

## 2. Real-time vs plain collaboration

| | Plain (async) collab | Real-time collab |
|---|---|---|
| Example | Git, emailed files | Google Docs, Figma, PairSpace |
| Edits meet | Later, at an explicit merge | Continuously, per keystroke |
| Conflict resolver | A human | The system, automatically |
| Latency needed | Seconds to days | ~100 ms |
| Hard part | Merge quality | Merging while people are still typing |

## 3. The problem and the unavoidable facts

**Problem:** N people each hold a *replica* (their own copy) and edit it at any moment. All replicas must *converge* (end identical) and nobody's intent may be silently lost.

| # | Unavoidable fact | Consequence |
|---|---|---|
| 1 | No shared memory between machines | Only messages can sync them |
| 2 | Messages take variable time | Others' screens are stale until delivery |
| 3 | No shared clock | "Who typed first" has no objective answer |
| 4 | Messages can be lost, duplicated, reordered | Arrival order is not sending order |
| 5 | Clients disconnect and rejoin | Replicas drift, then must reunite |

## 4. Concepts learned

### Network and transport
| Concept | Key points |
|---|---|
| **NAT** | Home devices share one public IP. The router only forwards replies to connections a device opened *outward*; unsolicited inbound packets are dropped. So a browser can call out but not be called |
| **WebRTC** | Browser built-in for direct browser-to-browser links (data channel for bytes). Steps: signaling (a server introduces the peers), STUN/hole punching (both call out at once), TURN (relay fallback). Still needs a server |
| **P2P vs relay** | P2P: fewer hops, less server load, but needs signaling + TURN anyway, no central authority, hard to observe. Relay: one place to order, log, persist and fault-inject, but an extra hop and a single point of failure |
| **Why a DB needs a server** | A browser cannot speak a database protocol directly (no API, and credentials would be exposed), so P2P still needs a server for persistence |
| **HTTP limits** | Request/response only. The server cannot speak first, so it can't push Alice's edit to an idle Bob |
| **WebSocket** | Starts as an HTTP request with `Upgrade: websocket`, then the same TCP connection stays open and both sides can send anytime. Client opens it outbound, so NAT is not a problem |
| **WebSocket gaps** | Dead connections aren't always noticed (need heartbeats/ping-pong); no auto-reconnect; order only holds within one connection; each user holds a connection open; message format is ours to design |
| **Alternatives to WebSocket** | Polling (delay + wasted requests), long polling (header overhead per message), SSE (server to browser only) |

### Sync
| Concept | Key points |
|---|---|
| **Local-first typing** | Show your own edit instantly, sync in the background. The relay's 2-hop delay is hidden from the typist. Cost: replicas diverge briefly and need merging |
| **Why naive sync breaks** | Positions shift. Start `hello`; Alice inserts `X@0`, Bob inserts `Y@5`. Applied unchanged, Alice gets `XhellYo` and Bob gets `XhelloY`: divergence, and Alice's `Y` lands mid-word |
| **Fix (transform)** | Adjust an incoming position for edits already applied locally. Alice applies Bob's edit as `Y@6`, and both get `XhelloY`. Known hole: two inserts at the *same* position need a deterministic tie-break |
| **Sync methods** | Locking (not truly concurrent); last-writer-wins (loses work); OT (server orders edits, each is rewritten against earlier ones: Google Docs); CRDT (every character has a unique ID, merge order doesn't matter: Yjs); leader peer |
| **Transport vs algorithm vs implementation** | Three independent choices. CRDTs also work through a relay; OT classically needs a central server |
| **Why a server simplifies sync** | The server fixes a single order (facts 3 and 4), leaving only the position-shift problem |
| **Figma's trick (from memory, unverified)** | Objects have IDs and properties, so edits refer to IDs instead of positions; server order breaks ties |
| **Reconnect options** | A: send whole text (overwrites, loses work). B: send only changes. C: B plus a marker ("I've seen up to #42; give me everything after"). C includes B. In P2P the marker becomes a version vector |

## 5. Decision log

Moved here from `CLAUDE.md` (which now holds only working instructions). Append one row per decision. Rows marked SUPERSEDED were replaced by the 'Tooling reset'.

| Date | Decision | Why | Rejected |
|---|---|---|---|
| 2026-10-18 | Start with 2 users per room, grow to N later | Smallest case that still has the real problem (concurrent edits, delay, reorder); more users add scale, not new kinds of problem (to be verified when we reach N) | Designing for N up front (more orderings to reason about before anything works) |
| 2026-10-18 | Build an MVP first, keep architecture open, improve on top | Learn from a running system's limits instead of guessing them | Full up-front design |
| 2026-10-18 | MVP transport: client-server relay (not P2P/WebRTC) | A server is unavoidable anyway (introductions, persistence); it also gives one place to order and observe messages | P2P/WebRTC for MVP (adds NAT/TURN plumbing, no central authority); revisit later as an experiment |
| 2026-10-18 | Local-first typing: show own edit instantly, sync in background | Typist must not feel the 2-hop relay delay (fact 2); cost is that replicas diverge briefly and need merging | Wait for server confirmation before showing (laggy, hides the real problem) |
| 2026-10-18 | Reconnect: client remembers last seen version, asks server for everything after it | Server's ordered log makes "what did I miss" cheap and loses nothing | Send whole text (overwrites and loses the other side's work) |
| 2026-10-19 | Sync algorithm: borrow a production-grade CRDT library instead of writing our own transform | Merging is a solved, well-tested problem; our learning effort goes to the layers around it (transport, rooms, persistence, reconnect, presence, fault injection) | Writing our own OT-style transform (more learning on sync, but not where we want to spend effort) |
| 2026-10-19 | Sync library: Yjs | Editor bindings, presence (awareness), persistence hooks; JavaScript so it runs in browser and server | Automerge, own implementation |
| 2026-10-19 | Language: TypeScript/Node for client and server | Browser runs JS and Yjs is JS; one language on both sides | Other server languages (would split the codebase in two) |
| 2026-10-19 | WebSocket protocol: borrow the `ws` library; write relay logic ourselves | Handshake and frame parsing is protocol plumbing with no learning value; the message logic, rooms, heartbeats and failure handling are where the engineering is | Hand-writing the protocol from raw TCP |
| 2026-10-19 | Native WebSockets, not Socket.IO | We want to build and see heartbeats, reconnect and rooms ourselves; native has less per-message overhead, sends Yjs binary updates directly, and matches Yjs's standard providers | Socket.IO (hides the failure handling we want to learn; revisit as a comparison experiment) |
| 2026-10-19 | (runner part SUPERSEDED by the tooling reset below; the rest still holds) Automated tests with Node's built-in `node:test` (no browser); one spec file per module; each test gets its own server on a random port; known gaps tracked as `todo` tests | Tests are repeatable, fast (~0.5s) and double as a readable spec; a test is only trusted after we break the code on purpose and watch it fail (mutation check) | Manual browser clicking (not repeatable); Jest/Vitest (extra dependency with no benefit yet) |
| 2026-10-19 | (SUPERSEDED in part: formatter/linter now added via Biome; Node-native-TS rationale dropped) Minimal scaffolding now: git, `.gitignore`, `.nvmrc` + `engines` (Node >=24), clean `package.json` (`private`), README. Defer formatter/linter, CI, Docker, workspaces, `.env.example` | Each added item must solve a problem we actually have; Node >=24 is required because we run TypeScript without a build tool | Adding the full toolchain up front (premature, hides which tool solves which problem) |
| 2026-10-19 | SUPERSEDED 2026-10-20 (deploy at MVP instead, see last row): Deploy early and often, starting with the current relay | Many small pushes to production are easier to debug than one late big deploy; production-only issues (TLS, idle-connection timeouts, env config, restarts) surface one at a time | Deploying late, once features are "done" |
| 2026-10-19 | Tooling reset (supersedes the `node:test` and run-TS-natively decisions): Vitest for tests, tsx for dev, tsup (esbuild) to build `dist/` for production, Biome for lint + format, npm for packages | Conventional tools a professional team would use; Vitest has per-test timeouts, watch mode, TS support and will be shared with the Vite web client; a compiled `dist/` is what hosting platforms expect | `node:test`, Node's native TS stripping (fewer deps but extra constraints: `.ts` import extensions, erasable-syntax-only), ESLint+Prettier (two tools instead of one). Deferred: pnpm/workspaces until the web package exists |
| 2026-10-19 | SUPERSEDED by the tooling reset above: Run TypeScript natively with Node 24 (no build tool), `tsc` for type checks only | Fewer moving parts; Node strips types itself | tsx/ts-node, bundlers (add only when a real need appears) |
| 2026-10-20 | Deploy when the MVP (complete full-stack working model) is built, not before. Phase 2 (production-ready, battle-tested, benchmarks for the resume) comes after | The user's call on scope and timing: first a complete working product, then hardening with real numbers | Deploying the bare relay now (earlier decision) |
| 2026-10-20 | MVP scope: landing, auth (email + GitHub), dashboard, room editor, edit/view-only share links, session replay, sync inspector with bad-network toggle. Out: run-code, multi-file, chat, video | "Just an editor" is too thin for a full-stack project; replay and the inspector are distinctive and reuse the data and measurements the distributed-systems phase needs | Editor only (2 pages); run-code; multi-file projects |
| 2026-10-20 | Amend MVP scope: add multi-file projects; skip video chat | Multi-file makes it feel like a real editor and adds a benchmark dimension (files per room) plus a new concurrency case (edit vs delete/rename). Video adds nothing to the sync story and is a separate domain | Single file per room; video chat now (revisit later with a hosted component, not custom WebRTC) |
| 2026-10-20 | Add in-browser code execution (JS + Python) to the MVP; server-side execution goes to Phase 2 | A code editor that can't run code feels pointless. In-browser is cheap and safe (browser sandbox); server-side needs real isolation, a queue and workers, which suits the Phase 2 scaling benchmarks | No execution at all; server-side execution in the MVP (security and infra too heavy); custom container isolation (use an existing engine) |
| 2026-10-21 | Editor: CodeMirror 6 | Light, fast first load (the 'amazed' first click), best Yjs binding (y-codemirror.next: remote cursors with names, shared undo), mobile-friendly | Monaco (VS Code feel and IntelliSense, but several MB heavier, worker setup, weak on mobile) |
| 2026-10-21 | Yjs transport: hybrid. Standard `y-websocket` client provider + our own server speaking the official protocol via `y-protocols` | Reconnect, resync and awareness come for free on the client; our server keeps the hooks M3 (update log with author and time), M5 (reject view-only edits) and M9 (metrics) need | Ready-made y-websocket server (would need patching for auth, roles, logging); fully own protocol (reinvents solved parts) |
| 2026-10-21 | Frontend: Vite + React + TypeScript, Tailwind CSS, shadcn/ui when components are needed, React Router; npm workspaces (`server`, `web`) with Biome at the root | Standard, well-supported stack; workspaces let one install and one lint/format config cover both packages | Other frameworks; separate repos; pnpm (npm already in use, no current need) |
| 2026-10-21 | Room document model: `files` map of fileId to {name, content: Y.Text}; the server creates the first file when it opens a room | If clients created the first file, two people opening a new room at once would each create one and the shared map would keep only one, silently losing edits | Client-side initialization |
| 2026-10-21 | CI: GitHub Actions on every push to `main` and every pull request. Two parallel jobs: (1) typecheck, lint, unit/integration tests, build; (2) Playwright e2e in Chromium, uploading traces on failure | Free for public repos, lives next to the code, the standard choice; parallel jobs keep feedback fast; traces make a CI-only failure debuggable | CircleCI, GitLab CI (extra service for no gain); one sequential job (slower) |

**Open decisions:** hosting (decide when the MVP is ready; a managed platform was the recommendation); when wiring Yjs, use `y-websocket`'s ready-made server instead of our own relay?

## 6. Hard parts that remain (even with Yjs)

Yjs merges bytes in memory. Everything else is ours.

| # | Problem | How to verify |
|---|---|---|
| 1 | **Persistence**: when to save, durability vs write load, log growth and compaction | Kill the server mid-typing, then measure loss and growth |
| 2 | **Reconnect/resync**: duplicate or partial delivery, server restart, long-offline client | Fault-inject disconnects, then check identical docs and time the recovery |
| 3 | **Fault-injection harness**: delay/drop/reorder/duplicate proxy plus convergence checker | Chaos run, check the docs never differ |
| 4 | **Room lifecycle and scaling**: load/evict rooms, memory per room, multi-server routing | Load test; watch memory |
| 5 | **Presence**: ephemeral cursors, throttling, ghost-user cleanup, heartbeats | Cut a tab's network, time the ghost cursor |
| 6 | **Latency/throughput**: batching vs responsiveness, big pastes, slow clients | p50/p99 end-to-end latency |
| 7 | **Safety limits**: message size, rate limits, malformed updates, who can join | Send huge or garbage messages |
| 8 | **Replay/history** (from `idea.md`) | Scrub through a session timeline |

Also: collaborative undo/redo (each user undoes only their own edits) is subtle, and it lives in the editor layer.

## 7. Current position and next steps

**M1 is done.** Two people on the same room link co-edit one file live, with names, colours, labelled cursors and a connection status.

| Part | Where | Tests |
|---|---|---|
| Sync server: Yjs sync and presence over WebSocket, rooms in memory, server-created first file, input validation | `server/src/sync-server.ts` (started by `server/src/index.ts`) | `server/test/sync-server.test.ts` (23) |
| Room session: the client-side module the UI uses (join, files, people, status, change notifications) | `web/src/room/session.ts` | `web/src/room/session.test.ts` (4) |
| UI: routing, room page, header, CodeMirror editor, guest identity | `web/src/App.tsx`, `web/src/pages/RoomPage.tsx`, `web/src/room/*.tsx`, `web/src/room/guest.ts` | `e2e/room.spec.ts` (4) + `e2e/smoke.spec.ts` |

**Known gaps (planned):** nothing is saved (M3); no heartbeats, so a silently dead connection lingers until the OS notices (M2); reconnect UX is the provider's default (M2); no message size limit (M2); the web bundle is 866 kB, needs code splitting (M10).

**Next: M2 reliability** (heartbeats, reconnect with resync, offline edits, fault-injection test). See `ROADMAP.md`.

