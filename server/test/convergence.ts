// The convergence experiment: do all copies of a shared document end up identical, with nothing
// lost, however bad the network? Three Yjs clients edit one room on the real sync server, each
// through its own fault-injection proxy (faulty-network.ts), with the same seeded edits twice:
//   clean:  no faults
//   faulty: 10-50 ms delay each way, a dropped connection every 10 edits, and one client offline
//           for 20 of the 60 edits (it keeps editing, and merges when it's back)
// It prints how many runs converged, how much typing was lost, how many connections dropped, and
// how long after the last edit every copy matched. Run i always uses seed i: the same command
// gives the same edits and faults. Exits 1 if any run failed to converge or lost anything.
//
//   npm run convergence            (100 runs of each)
//   npm run convergence -- 200     (200 runs of each)

import { performance } from "node:perf_hooks";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { createSyncServer } from "../src/sync-server";
import { createFaultyNetwork } from "./faulty-network";
import { seededRandom } from "./random";

const CLIENTS = 3;
const EDITS = 60;
const GIVE_UP_MS = 10_000;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function until(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = performance.now();
  while (!condition()) {
    if (performance.now() - start > timeoutMs) return false;
    await sleep(1);
  }
  return true;
}

interface Run {
  converged: boolean;
  typed: number; // characters
  lost: number;
  drops: number;
  settleMs: number; // from the last edit until every copy matched
}

type Client = { doc: Y.Doc; provider: WebsocketProvider };
type Link = Awaited<ReturnType<typeof createFaultyNetwork>>;

// three people in one room, each through their own link, once everyone has the room
async function connect(links: Link[], room: string): Promise<Client[]> {
  const clients = links.map((link) => {
    const doc = new Y.Doc();
    // reconnecting on y-websocket's own timing, as the app does (the tests shorten it); no
    // BroadcastChannel: in one process it would sync clients past the server
    return { doc, provider: new WebsocketProvider(link.url, room, doc, { disableBc: true }) };
  });
  await until(() => clients.every((c) => c.provider.synced), GIVE_UP_MS);
  return clients;
}

// the faulty network's events at one edit: a dropped connection every 10 edits, and the second
// person offline from edit 20 to 40
function fault(links: Link[], step: number, faults: () => number) {
  if (step % 10 === 5) links[Math.floor(faults() * CLIENTS)].cut();
  if (step === 20) links[1].offline();
  if (step === 40) links[1].online();
}

// the people take turns typing at random places; returns how many characters they typed
async function type(clients: Client[], edits: () => number, onEdit: (step: number) => void) {
  let typed = 0;
  for (let step = 0; step < EDITS; step++) {
    const text = clients[step % CLIENTS].doc.getText("code");
    const chunk = `${step % CLIENTS}${"x".repeat(Math.floor(edits() * 3))}`;
    text.insert(Math.floor(edits() * (text.length + 1)), chunk);
    typed += chunk.length;
    onEdit(step);
    await sleep(edits() * 20); // typing pace: edits, deliveries and faults interleave
  }
  return typed;
}

async function run(port: number, seed: number, faulty: boolean): Promise<Run> {
  const edits = seededRandom(seed); // the same edits on both networks
  const faults = seededRandom(seed + 1_000_000); // only the faulty network draws from this
  const links = await Promise.all(Array.from({ length: CLIENTS }, () => createFaultyNetwork(port)));
  const clients = await connect(links, `${faulty ? "faulty" : "clean"}-${seed}`);
  let drops = 0;
  let measuring = true; // closing the clients at the end isn't a dropped connection
  for (const c of clients) c.provider.on("connection-close", () => measuring && drops++);
  if (faulty) for (const link of links) link.delay(10, 40);

  const typed = await type(clients, edits, (step) => faulty && fault(links, step, faults));

  const lastEdit = performance.now();
  const vectors = () => clients.map((c) => Y.encodeStateVector(c.doc).toString());
  const texts = () => clients.map((c) => c.doc.getText("code").toString());
  const converged = await until(
    () => new Set(vectors()).size === 1 && new Set(texts()).size === 1,
    GIVE_UP_MS,
  );
  const settleMs = performance.now() - lastEdit;
  const lost = typed - Math.min(...texts().map((t) => t.length));

  measuring = false;
  for (const c of clients) c.provider.destroy();
  await Promise.all(links.map((link) => link.close()));
  return { converged, typed, lost, drops, settleMs };
}

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

function summarize(name: string, runs: Run[]) {
  const settle = runs
    .filter((r) => r.converged)
    .map((r) => r.settleMs)
    .sort((a, b) => a - b);
  const ms = (value: number | undefined) => (value === undefined ? "-" : `${Math.round(value)} ms`);
  const drops = runs.reduce((sum, r) => sum + r.drops, 0);
  return {
    network: name,
    "runs converged": `${runs.filter((r) => r.converged).length}/${runs.length}`,
    "characters lost": `${runs.reduce((sum, r) => sum + r.lost, 0)} of ${runs.reduce((sum, r) => sum + r.typed, 0)}`,
    "connections dropped": `${drops} (${(drops / runs.length).toFixed(1)} per run)`,
    "settle median": ms(percentile(settle, 50)),
    "settle p95": ms(percentile(settle, 95)),
    "settle max": ms(settle.at(-1)),
  };
}

const count = Number(process.argv[2] ?? 100);
const server = await createSyncServer({ port: 0, log: () => {} });
console.log(
  `Convergence: ${CLIENTS} clients, ${EDITS} edits per run, seeds 1-${count} (same edits on both networks)\n`,
);
const results: Record<string, Run[]> = { clean: [], faulty: [] };
for (const faulty of [false, true]) {
  for (let seed = 1; seed <= count; seed++) {
    results[faulty ? "faulty" : "clean"].push(await run(server.port, seed, faulty));
    if (process.stdout.isTTY) {
      process.stdout.write(`\r${faulty ? "faulty" : "clean "} network: run ${seed}/${count}`);
    }
  }
}
if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
console.table([summarize("clean", results.clean), summarize("faulty", results.faulty)]);
await server.close();

const failed = [...results.clean, ...results.faulty].filter((r) => !r.converged || r.lost > 0);
process.exit(failed.length > 0 ? 1 : 0);
