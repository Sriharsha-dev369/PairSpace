# PairSpace: Context (state of thinking so far)

How the three files relate:

| File | Purpose |
|---|---|
| `idea.md` | *What* we're building (source of truth for the product) |
| `CLAUDE.md` | Working instructions for Claude (commands, stack, workflow). Local only: it is in `.gitignore` |
| `context.md` (this file) | *Where we are*: what was reasoned, decided and learned, and what's next |

Status: idea deep-dive done; relay server with rooms built, tested, ready to deploy. Last updated 2026-10-20.

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
| 2026-10-19 | Deploy early and often, starting with the current relay | Many small pushes to production are easier to debug than one late big deploy; production-only issues (TLS, idle-connection timeouts, env config, restarts) surface one at a time | Deploying late, once features are "done" |
| 2026-10-19 | Tooling reset (supersedes the `node:test` and run-TS-natively decisions): Vitest for tests, tsx for dev, tsup (esbuild) to build `dist/` for production, Biome for lint + format, npm for packages | Conventional tools a professional team would use; Vitest has per-test timeouts, watch mode, TS support and will be shared with the Vite web client; a compiled `dist/` is what hosting platforms expect | `node:test`, Node's native TS stripping (fewer deps but extra constraints: `.ts` import extensions, erasable-syntax-only), ESLint+Prettier (two tools instead of one). Deferred: pnpm/workspaces until the web package exists |
| 2026-10-19 | SUPERSEDED by the tooling reset above: Run TypeScript natively with Node 24 (no build tool), `tsc` for type checks only | Fewer moving parts; Node strips types itself | tsx/ts-node, bundlers (add only when a real need appears) |

**Open decisions:** hosting for the first deploy (managed platform recommended); when wiring Yjs, use `y-websocket`'s ready-made server instead of our own relay?

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

**Built so far (`server/` and `web/`):**
- `server/src/relay.ts`: WebSocket relay with rooms (room = URL path, name validated, empty rooms removed). `server/src/index.ts` starts it; port comes from `PORT` (default 8080).
- `server/test/relay.test.ts`: 26 Vitest tests (relaying, rooms, name validation, edge cases) plus 4 `todo` tests for known gaps (heartbeat, max message size, presence, catch-up).
- Tooling: Vitest, tsx, tsup, Biome, npm. Checks: `npm run typecheck`, `npm run lint`, `npm test`.
- `web/test.html`: bare manual test page (room in `#hash`), only for eyeballing.

**Next (in order):**
1. **First commit and first deploy** of the relay (managed platform from a private GitHub repo). Waiting on the user: GitHub login for `gh`, and hosting choice.
2. **Heartbeats**, driven by what the deployed server shows (proxies drop idle connections, dead clients linger in rooms). The `todo` test is the spec.
3. **Yjs**: decide `y-websocket`'s ready-made server vs our own relay, then wire up the editor client (Vite).

