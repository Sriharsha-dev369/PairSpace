# PairSpace: Context (state of thinking so far)

How the three files relate:

| File | Purpose |
|---|---|
| `idea.md` | *What* we're building (source of truth for the product) |
| `CLAUDE.md` | Working instructions for Claude (commands, stack, workflow). Local only: it is in `.gitignore` |
| `context.md` (this file) | *Where we are*: what was reasoned, decided and learned, and what's next |

Status: M1 done (live co-editing, presence, cursors, tested end to end). M2 reliability done: heartbeats, message size limit, fault-injection tests (M2's done-when), and reconnecting UX (steady Reconnecting/Offline states, leave-page warning for unsynced edits, paste guard). M3 persistence done: every change saved to Postgres with author and time, rooms rebuilt on first join, writes batched per room, snapshots keep loading fast, empty rooms unloaded once saved; a server restart loses nothing. M4 accounts in progress: sign up, sign in and sign out with email and password (4.1). Not deployed. Last updated 2026-10-31.

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
| **Heartbeat** | A peer that vanishes (sleep, wifi drop) never sends a TCP close, so its socket looks open for hours (a *half-open* connection). The server pings each connection every 10s and cuts one that didn't answer the previous ping. Browsers answer pings automatically, but page JS can't see them, so the server also sends a tiny keepalive message: y-websocket drops a connection it hears nothing on for 30s |
| **What TCP guarantees** | Within one connection, bytes arrive complete, once and in order, or the connection dies. Packet loss shows up as delay (TCP resends) or a dead connection, never as a missing, repeated or reordered message. So the realistic faults to test are delay, a dropped connection, going offline, and a frozen (half-open) connection |
| **Browser `offline`/`online` events** | The browser fires `offline` on `window` when the device has no network at all. An open WebSocket can keep looking open (no close arrives), so react to the event instead of waiting for the socket. `online` only means a network exists, not that the server is reachable |
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
| **Causal dependencies** | Each Yjs insert is anchored to the character it was typed after. If one change is missing, every later change built on it waits, invisible, until it arrives. So a store may delay or reorder changes but must never drop one |
| **Group commit** | Changes that arrive while a write is in flight wait for the next write, so writes batch themselves under load even without a timer. The timer bounds the wait when the load is light |
| **Snapshot + log** | Keep every change (the log) and, now and then, the whole state with the position it covers. Loading reads the snapshot and only the log after it. Overlap between the two is safe because changes are idempotent; a gap would lose data, so the snapshot is taken after the changes it claims are written |

### Accounts
| Concept | Key points |
|---|---|
| **Session** | A row with a random token and an expiry. The browser keeps the token in an HttpOnly cookie (page scripts can't read it) and sends it with every request to the server that set it, which is how the server knows who you are. Signing out deletes the row, so the cookie stops working |
| **Password hashing** | Only a slow one-way hash is stored (scrypt), so a leaked database doesn't reveal passwords |
| **CSRF** | Another website can make your browser send a request to us, and the browser attaches our cookie. The request's `Origin` header names the site that sent it, so the server refuses state-changing requests from any origin it doesn't trust |
| **HTTP upgrade** | A WebSocket begins as an HTTP request asking to switch protocols, so one port serves both, and the switch request carries the cookies |

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
| 2026-10-21 | Empty rooms stay loaded in memory until M3; unloading arrives together with saving | Unloading a room before its document is saved loses the file ids: a person who briefly dropped reconnects, the server creates a new `main.js`, and the room ends up with two files (found in review, reproduced in a test). M3 reloads the saved doc, which makes unloading safe | Unload after a grace period (a longer blip still duplicates); deterministic first-file id (two concurrent sets of one map key keep only one, silently losing an edit) |
| 2026-10-28 | Heartbeat: every 10s the server pings each connection and terminates one that didn't answer the previous ping; the close handler then removes its presence | The documented `ws` pattern; browsers answer pings with no client code. Dead connections go in 10–20s, before Yjs's 30s presence timeout, and stop holding rooms open | OS TCP keepalive (default about 2h); relying on the awareness timeout (removes presence but leaves the dead socket in the room) |
| 2026-10-28 | Keepalive: on the same tick, send each connection an awareness message listing nobody (3 bytes) | y-websocket drops a connection it hears nothing on for 30s, so a person alone in an idle room was disconnected every ~33s (reproduced). The empty update is a no-op for clients and uses the existing protocol | Echoing every awareness update back to its sender like y-websocket's reference server (doubles cursor traffic to each sender); a new message type (y-websocket logs an error); query-awareness (every client replies); periodic sync step 1 (a resync round trip each tick) |
| 2026-10-28 | Heartbeat interval 10s, configurable (`heartbeatMs`; tests use 50ms) | 3x margin under the client's 30s silence limit | 30s, the `ws` README default (no margin, and ghosts could linger up to 60s) |
| 2026-10-28 | Limit each message to 2 MiB (`maxMessageBytes`) with `ws`'s `maxPayload`, which closes with the standard code 1009 | `ws` checks a frame's declared length before reading it, so an oversize message is never buffered. The biggest legitimate message is a whole room re-sent after the server lost it (a restart before M3), so this allows rooms of about 1–1.5 MB of code | `ws`'s 100 MiB default (one client can make the server hold, apply and broadcast 100 MiB); checking size in our message handler (already buffered by then); 1 MB like Socket.IO's default (a big pasted file would fail); a custom 44xx code (`ws` sends 1009 itself) |
| 2026-10-28 | The client treats close 1009 as permanent: it stops reconnecting and the header says "Change too large to sync" | y-websocket's default retries 1009, and every retry re-sends the same change, so it looped every ~200ms and never synced (seen in a test: 3 joins in 600ms) | The default retry; making the server send a 44xx code instead (not possible with `maxPayload`) |
| 2026-10-28 | Fault injection with our own in-process TCP proxy (`server/test/faulty-network.ts`): delay with jitter (order kept), cut, offline/online, freeze; one per client | Tests control each link directly; no daemon to install or start; runs in Vitest and CI as is; about 100 lines on `node:net`. A chaos test (3 clients, jittery links, cuts, an offline spell) ends identical with nothing lost: M2's done-when | Toxiproxy, the standard tool (a separate daemon to install in CI and start before tests, configured over HTTP; worth revisiting for Phase 2 benchmarks against deployed infrastructure); a WebSocket-level proxy that drops, reorders or duplicates single messages (impossible on one TCP connection, so it would test cases that can't happen); patching the client's WebSocket (misses server-side behaviour like heartbeats) |
| 2026-10-30 | The client listens for the browser's `offline`/`online` events: on `offline` it disconnects at once and shows "Offline"; on `online` it reconnects at once. After a drop the status stays "Reconnecting…" through every retry | With wifi gone, an open socket kept the header on "Connected" for up to 30s (seen in a browser test: Chromium's offline mode leaves the socket looking open). The provider emits `connecting` on each retry but nothing when one fails, so the old status flickered and never reassured | A client watchdog on the server's 10s keepalives (gains ~10s only for silent path failures, plus another timer); leaving y-websocket's 30s rule alone |
| 2026-10-30 | Unsynced edits = edits made while not connected, cleared at the next `sync`. While any exist, the header says "your edits will sync when you're back" and closing the tab asks first (`beforeunload`) | Our server sends its sync step 1 on connect, so by the client's `sync` event its reply carrying those edits has been sent (TCP keeps order). No protocol change | Per-update acks from the server (protocol change; exact pending counts belong to M9's sync inspector); `y-indexeddb` to keep edits across reloads (a stale local copy could re-upload a room after it's deleted or access is revoked; revisit after M3/M5) |
| 2026-10-30 | The editor refuses a typed, pasted or dropped change over 1 MiB (UTF-8, as Yjs sends it) and says so in a toast (`sonner`, shadcn/ui's toast) | Half the server's 2 MiB limit, because on reconnect all offline edits travel in one message. Without it, one big paste put the tab into "Change too large to sync" for good. Other people's changes (from Yjs) aren't limited | The server's 2 MiB (one more offline edit and the reconnect is refused); a dialog (blocks typing) |
| 2026-10-31 | Database: Postgres 18. Locally in Docker Compose (host port 5433), in CI a service container on the same port; tests use their own `pairspace_test` database, created and migrated by Vitest's global setup | Relational data is coming (users, members, roles, share links need joins, foreign keys and transactions); Phase 2's several servers need one shared database; tests run on the real thing | MongoDB (Yjs data is opaque bytes, so flexible documents add nothing, and M4/M5 are relational); SQLite (one machine only); a fake database in tests (misses real behaviour) |
| 2026-10-31 | Database access: Drizzle ORM, with drizzle-kit generating SQL migrations that are committed and applied on server start | Schema in TypeScript, queries shaped like SQL (learn SQL, not an abstraction), light | Prisma (heavier, hides more SQL); raw `pg` with node-pg-migrate (more hand-written SQL) |
| 2026-10-31 | Store every change in an append-only log (`room_updates`: room, bytes, author, time); a room is rebuilt by merging its changes on first join | Replay (M8) needs every change with its author and time; Yjs changes give the same result in any order and when applied twice, so merging them rebuilds the document exactly | Saving only the latest full state (history lost) |
| 2026-10-31 | The server defines the `RoomStore` interface it needs (`load`, `append`) and takes a store as an option; without one, rooms stay in memory as before | The server doesn't depend on Drizzle or Postgres; existing tests stay fast and database-free; tests can pass a failing store | The server importing the database directly |
| 2026-10-31 | A new room's first file is saved before anyone is let in; a room that fails to load turns the client away with 1011, which clients retry | A restart can never give a room a second file (the known gap, now fixed and tested); a database hiccup costs a retry, not a broken room | Saving the first file with the first edit (a crash in between brings the second-file bug back); keeping the connection open without a room |
| 2026-10-31 | Batched writes: a room's changes wait at most 0.5s (`saveDelayMs`), then one row per person per batch (`Y.mergeUpdates`), one write per room at a time; a failed write is put back and retried; `close()` writes everything waiting | Typing bursts become a few writes per second per room instead of one per keystroke. Open tabs re-send their copy on reconnect, so a crash loses only edits whose authors also closed their tabs within 0.5s. A dropped write must never be skipped: later Yjs changes build on it (seen in a test: one lost keystroke left the saved text empty) | Debounce until typing stops (a non-stop typist is never saved); one write per change (3.1); dropping a failed write |
| 2026-10-31 | Snapshots: after every 100 written rows (`snapshotEvery`), the server saves the room's whole document on `rooms` with its position (the id of the last change it includes); loading = snapshot + only the changes after it. History is never deleted. `append` returns the position and the server passes it explicitly; a failed snapshot is logged and retried after the next write | Load cost stays bounded while replay (M8) keeps every change. The state is captured after the write, so it holds everything up to its position (a few extra later changes are harmless: applying a change twice changes nothing). An explicit position stays correct even when another writer appends meanwhile (Phase 2) | Deleting old changes after a snapshot (breaks replay); the store taking the latest row as the position (wrong with two writers); snapshots on a timer (idle rooms snapshot for nothing); guarding against an older snapshot replacing a newer one (it only costs extra replay, never data) |
| 2026-10-31 | Unload an empty room 30s after the last person leaves (`unloadAfterMs`): write everything waiting, check again that it's still empty, then drop it; never without a store; joining cancels a pending unload; `close()` cancels them all | Frees memory without a database read on every page reload; the re-check closes the race where someone joins while the last write is in flight (dropping the room then would leave them in a copy nobody else can reach, seen in a test) | Unloading at once (every reload re-reads the room); never unloading (memory grows with every room ever opened); unloading without a store (loses the room) |
| 2026-10-31 | Accounts with Better Auth, running in our server, users and sessions in our Postgres via Drizzle (tables `users`, `sessions`, `accounts`, `verifications`) | The TypeScript standard (the Auth.js team now maintains it); email and GitHub built in; no outside service; sessions are rows we can inspect | Auth.js (Next.js-centred, now in maintenance); Clerk (hosted, paid beyond a tier, users outside our database); hand-rolled (security-critical) |
| 2026-10-31 | Email + password sign-in; verification and password-reset emails wait for an email provider, chosen at deploy (M11) | Works with no email service | Magic links (need an email service from day one) |
| 2026-10-31 | One port for HTTP and WebSockets: Hono serves `/api/auth/*`, and the sync server attaches to the same Node HTTP server (`createSyncServer({ server })`); `startApp` in `server/src/app.ts` wires both | A WebSocket starts as an HTTP request, so the upgrade carries the session cookie; one origin to deploy | A separate auth server (two origins, CORS, cookies across them) |
| 2026-10-31 | Guests join rooms by invite link with a display name; only signed-in members create rooms. M4's done-when becomes "a connection without a session cannot create a room"; members-only rooms arrive with M5's roles | No signup wall on the first click, and random room links can no longer fill the database | Everyone signs in (a wall for invitees); accounts optional (database growth stays open) |
| 2026-10-31 | Better Auth's origin (CSRF) checks are switched on explicitly (`advanced.disableOriginCheck: false`); the web app's origin is the auth `baseURL`, which makes it the one trusted origin | Better Auth silently skips these checks when `NODE_ENV=test` (found when a probe from another origin, carrying a valid session cookie, signed the user out); tests must run what production runs. A test now proves a cross-site request is refused | Relying on the default (tests would never exercise the protection); a separate `trustedOrigins` entry (redundant with `baseURL`, a mutation showed it changed nothing) |

**Open decisions:** hosting (decide when the MVP is ready; a managed platform was the recommendation); when wiring Yjs, use `y-websocket`'s ready-made server instead of our own relay?

## 6. Hard parts that remain (even with Yjs)

Yjs merges bytes in memory. Everything else is ours.

| # | Problem | How to verify |
|---|---|---|
| 1 | **Persistence**: when to save, durability vs write load, log growth and compaction. Built in M3 as an append-only change log with author and time, 0.5s batches per person, snapshots every 100 rows (history kept for replay), unloading after 30s empty | Kill the server mid-typing, then measure loss and growth |
| 2 | **Reconnect/resync**: duplicate or partial delivery, server restart, long-offline client | Fault-inject disconnects, then check identical docs and time the recovery |
| 3 | **Fault-injection harness**: delay/drop/reorder/duplicate proxy plus convergence checker. Built in M2 as delay, cut, offline and freeze (reorder and duplicate can't happen on one TCP connection; they matter again with several servers in Phase 2) | Chaos run, check the docs never differ |
| 4 | **Room lifecycle and scaling**: load/evict rooms, memory per room, multi-server routing | Load test; watch memory |
| 5 | **Presence**: ephemeral cursors, throttling, ghost-user cleanup, heartbeats | Cut a tab's network, time the ghost cursor |
| 6 | **Latency/throughput**: batching vs responsiveness, big pastes, slow clients | p50/p99 end-to-end latency |
| 7 | **Safety limits**: message size, rate limits, malformed updates, who can join | Send huge or garbage messages |
| 8 | **Replay/history** (from `idea.md`) | Scrub through a session timeline |

Also: collaborative undo/redo (each user undoes only their own edits) is subtle, and it lives in the editor layer.

## 7. Current position and next steps

**M1, M2 and M3 are done.** Two people on the same room link co-edit one file live, with names, colours, labelled cursors and a connection status. Dead connections are noticed, offline edits merge on return, and the UI says when it's reconnecting or offline. Rooms are saved to Postgres and survive a server restart.

| Part | Where | Tests |
|---|---|---|
| Sync server: Yjs sync and presence over WebSocket, rooms in memory and loaded from / saved to a store, server-created first file, input validation, heartbeats, message size limit | `server/src/sync-server.ts` (attached to the app's HTTP server) | `server/test/sync-server.test.ts` (35) |
| Room store: saves every change to Postgres, loads rooms back, history for replay | `server/src/room-store.ts`, `server/src/schema.ts`, migrations in `server/drizzle/` | `server/test/room-store.test.ts` (6), `server/test/persistence.test.ts` (15) |
| Accounts API: sign up, sign in, sign out (Better Auth); HTTP and WebSockets on one port | `server/src/auth.ts`, `server/src/app.ts` (started by `server/src/index.ts`) | `server/test/auth.test.ts` (6) |
| Faulty network (tests only): TCP proxy that delays, cuts, goes offline or freezes a client's link | `server/test/faulty-network.ts` | used by the sync server tests |
| Room session: the client-side module the UI uses (join, files, people, status incl. reconnecting/offline, unsynced edits, change notifications) | `web/src/room/session.ts` | `web/src/room/session.test.ts` (10) |
| Paste guard: CodeMirror filter refusing a change too large to sync | `web/src/room/syncSizeLimit.ts` | `web/src/room/syncSizeLimit.test.ts` (4) |
| UI: routing, room page, header, CodeMirror editor, guest identity | `web/src/App.tsx`, `web/src/pages/RoomPage.tsx`, `web/src/room/*.tsx`, `web/src/room/guest.ts` | `e2e/room.spec.ts` (12) + `e2e/smoke.spec.ts` |

**Known gaps (planned):** authors are display names, which aren't unique (4.2: user ids); no email verification or password reset until an email provider (M11); the web app has no sign-in pages yet (4.3); GitHub sign-in (4.4); any visit to a new room link creates a saved room (M5 creates rooms explicitly, M11 rate limits); losing wifi shows at once, but a silently dead server or path is noticed only after y-websocket's 30s silence limit; edits made offline live only in the tab until reconnect (closing it asks first; `y-indexeddb` after M3/M5); edits sent in the moments before a silent failure is noticed aren't counted as unsynced (they still sync on reconnect); each change is capped at 1 MiB, but many offline edits can still add up past the server's 2 MiB on reconnect, and rooms have no total size cap (M3/M11); the web bundle is 866 kB, needs code splitting (M10).

**Next: rest of M4** (4.2 the WebSocket server knows who connects, 4.3 sign-in pages, 4.4 GitHub). See `ROADMAP.md`.

