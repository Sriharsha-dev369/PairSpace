# PairSpace: Context (state of thinking so far)

How the three files relate:

| File | Purpose |
|---|---|
| `idea.md` | *What* we're building (source of truth for the product) |
| `CLAUDE.md` | *How* we work (teacher-first loop, first principles, decision log) |
| `context.md` (this file) | *Where we are*: what was reasoned, decided and learned, and what's next |

Status: **deep-dive on the idea is done. No code written yet.** Last updated 2026-10-19.

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

## 5. Decisions made

(Authoritative copy is the decision log in `CLAUDE.md`.)

| Date | Decision | Why | Rejected |
|---|---|---|---|
| 2026-10-18 | Start with 2 users per room, grow to N later | Smallest case with the real problem; to verify at N that more users add scale, not new kinds of problems | Design for N up front |
| 2026-10-18 | Build an MVP first, keep architecture open | Learn from a running system's limits | Full up-front design |
| 2026-10-18 | MVP transport: client-server relay | Server needed anyway (introductions, persistence); one place to order and observe | P2P/WebRTC for MVP (revisit later as an experiment) |
| 2026-10-18 | Local-first typing | Hide the 2-hop delay from the typist | Wait for server confirmation |
| 2026-10-18 | Reconnect via last-seen marker | Cheap, loses nothing | Send whole text |
| 2026-10-19 | Sync: borrow a production CRDT library | Merging is a solved problem; effort goes to the layers around it | Own OT-style transform |
| 2026-10-19 | Library: Yjs | Editor bindings, presence, persistence hooks; JS in browser and server | Automerge, own implementation |
| 2026-10-19 | Language: TypeScript/Node for client and server | One language on both sides | Other server languages |

**Deferred (decide when it comes up):** database choice (e.g. MongoDB vs others), editor component, whether to try WebRTC later as a transport experiment, whether to read Yjs internals later.

## 6. Hard parts that remain (even with Yjs)

Yjs merges bytes in memory. Everything else is ours.

| # | Problem | What to break/measure |
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

## 7. Current position and next step

**Built so far (all in `server/` and `web/`):**
- `server/src/relay.ts`: WebSocket relay with rooms (room = URL path, name validated, empty rooms removed). `server/src/index.ts` just starts it on port 8080.
- `server/test/relay.test.ts`: 26 automated tests (happy path, rooms, name validation, edge cases) plus 4 `todo` tests for known gaps (heartbeat, max message size, presence, catch-up). Run with `npm test` in `server/`. Mutation-checked: 4 deliberate bugs were each caught.
- `web/test.html`: bare manual test page (room in `#hash`), only for eyeballing.

**Testing convention:** every behavior gets a test first or alongside; wait for conditions (never sleep and hope); to prove a message did *not* arrive, wait for a known message then settle briefly.

- **Open question for the user:** a client's wifi dies silently with no "goodbye". How does the server tell "not typing" from "gone", and what should the UI show the other user? (Leads to heartbeats and presence.)
- **Next smallest thing to build:** a Node (TypeScript) WebSocket server plus two browser tabs exchanging messages, with logging of every message and the ability to kill connections, so behavior can be observed before Yjs is wired in.
- Process reminder: teach the why, let the user reason, check understanding, then build, then show how to break and measure it.
