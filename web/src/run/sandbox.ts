import type { Language } from "./runState";

// a room file as a JavaScript module, with where its imports point (7.2 fills them in)
export interface Module {
  path: string;
  source: string;
  imports: { start: number; end: number; path: string }[];
}

export interface Job {
  language: Language;
  modules: Module[]; // dependencies before what imports them
  entry: string;
  timeLimitMs: number;
}

export type Outcome = "done" | "failed" | "stopped" | "timed-out";

export type SandboxEvent =
  | { type: "started" }
  | { type: "output"; stream: "out" | "err"; text: string }
  | { type: "end"; outcome: Outcome; error?: string };

// the sandbox page and its worker, plain files in public/sandbox/: frame.js says why
const FRAME = "/sandbox/frame.html";
const WORKER = "/sandbox/worker.js";

// the worker's code, which goes to the frame with each run (fetched once, from our own origin)
let workerCode: Promise<string> | undefined;
const loadWorker = () => {
  workerCode ??= fetch(WORKER).then((response) => {
    if (!response.ok) throw new Error(`couldn't load ${WORKER}: ${response.status}`);
    return response.text();
  });
  workerCode.catch(() => {
    workerCode = undefined; // try again on the next run
  });
  return workerCode;
};
// loading a language (Python: a few seconds) isn't counted in the time limit, but is capped
const LOAD_LIMIT_MS = 60_000;

type FrameMessage = SandboxEvent | { type: "ready" };

// what the frame says is untrusted (the program can post anything): check it before believing it
function parse(data: unknown): FrameMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const { type, stream, text, outcome, error } = data as Record<string, unknown>;
  if (type === "ready" || type === "started") return { type };
  if (type === "output" && (stream === "out" || stream === "err") && typeof text === "string") {
    return { type, stream, text };
  }
  if (type === "end" && (outcome === "done" || outcome === "failed")) {
    return { type, outcome, error: typeof error === "string" ? error : undefined };
  }
  return null;
}

// runs a program in a fresh sandbox frame, reporting what it prints and how it ended (once);
// returns a way to stop it. Ending a run removes the frame, which ends its worker
export function runInSandbox(job: Job, onEvent: (event: SandboxEvent) => void): () => void {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts"); // no allow-same-origin: an opaque origin
  frame.src = FRAME;
  frame.title = "Code runner";
  frame.hidden = true;
  let ended = false;
  let sent = false;
  let started = false;
  let limit = setTimeout(() => end({ type: "end", outcome: "timed-out" }), LOAD_LIMIT_MS);

  function end(event: Extract<SandboxEvent, { type: "end" }>) {
    if (ended) return;
    ended = true;
    clearTimeout(limit);
    window.removeEventListener("message", listen);
    frame.remove();
    onEvent(event);
  }

  function sendJob() {
    if (sent) return;
    sent = true;
    loadWorker().then(
      (worker) => !ended && frame.contentWindow?.postMessage({ type: "run", job, worker }, "*"),
      () => end({ type: "end", outcome: "failed", error: "The runner couldn't load. Try again." }),
    );
  }

  // the clock starts once the language has loaded; a second "started" would restart it, so the
  // program can't buy itself time
  function startClock(message: SandboxEvent) {
    if (started) return;
    started = true;
    clearTimeout(limit);
    limit = setTimeout(() => end({ type: "end", outcome: "timed-out" }), job.timeLimitMs);
    onEvent(message);
  }

  function listen(event: MessageEvent) {
    if (ended || event.source !== frame.contentWindow) return;
    const message = parse(event.data);
    if (message?.type === "ready") sendJob();
    else if (message?.type === "started") startClock(message);
    else if (message?.type === "end") end(message);
    else if (message) onEvent(message);
  }

  window.addEventListener("message", listen);
  document.body.append(frame);
  return () => end({ type: "end", outcome: "stopped" });
}
