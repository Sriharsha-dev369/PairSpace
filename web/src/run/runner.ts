import type * as Y from "yjs";
import type { RoomFile } from "../room/files";
import { javascriptModules } from "./modules";
import {
  addOutput,
  type Chunk,
  currentRun,
  endRun,
  type Language,
  MAX_OUTPUT_LINES,
  markStarted,
  runStatus,
  startRun,
} from "./runState";
import { type Job, runInSandbox, type SandboxEvent } from "./sandbox";

export type Sandbox = (job: Job, onEvent: (event: SandboxEvent) => void) => () => void;

// how long a program may run before it's stopped (an endless loop, say)
const TIME_LIMIT_MS = 10_000;

const LANGUAGES: Record<string, Language> = { js: "javascript", mjs: "javascript", py: "python" };

// the language a file runs as, from its name; null if it doesn't run
export function runnableAs(name: string): Language | null {
  const dot = name.lastIndexOf(".");
  return dot > name.lastIndexOf("/") ? (LANGUAGES[name.slice(dot + 1)] ?? null) : null;
}

interface Options {
  doc: Y.Doc;
  me: { name: string; color: string };
  clientId: number; // this browser's presence id: others see the run as interrupted once it's gone
  present: () => Set<number>; // presence ids of the browsers in the room now
  sandbox?: Sandbox;
  timeLimitMs?: number;
  batchMs?: number; // output is written at most this often: one change for many prints
}

// what the browser of whoever pressed Run does: start the room's run, run the program in the
// sandbox, write what it prints into the room, and stop it when anyone asks
export function createRunner({
  doc,
  me,
  clientId,
  present,
  sandbox = runInSandbox,
  timeLimitMs = TIME_LIMIT_MS,
  batchMs = 50,
}: Options) {
  let stopMine: (() => void) | undefined;

  // the program the sandbox gets: the open file, and the room files it imports
  async function prepare(language: Language, file: RoomFile, files: RoomFile[]): Promise<Job> {
    const sources = files.map((each) => ({ name: each.name, source: each.content.toString() }));
    return {
      language,
      // Python finds its imports itself, among every Python file in the room
      modules:
        language === "python"
          ? sources
              .filter((each) => runnableAs(each.name) === "python")
              .map(({ name, source }) => ({ path: name, source, imports: [] }))
          : await javascriptModules(sources, file.name),
      entry: file.name,
      timeLimitMs,
    };
  }

  function run(file: RoomFile, files: RoomFile[]): boolean {
    const language = runnableAs(file.name);
    const last = currentRun(doc);
    if (!language || (last && runStatus(last, present()) === "running")) return false;

    const id = startRun(doc, { file: file.name, language, by: me, runner: clientId });
    const runs = doc.getMap("run");
    let pending: Chunk[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const flush = () => {
      clearTimeout(timer);
      timer = undefined;
      if (pending.length > 0) addOutput(doc, id, pending);
      pending = [];
    };
    const finish = (end: Extract<SandboxEvent, { type: "end" }>) => {
      if (finished) return;
      finished = true;
      runs.unobserveDeep(watch);
      stopMine = undefined;
      flush();
      endRun(doc, id, { status: end.outcome, error: end.error });
    };
    // someone asked to stop, or a run started at the same moment took this one's place
    function watch() {
      const now = currentRun(doc);
      if (now?.id !== id || now.stopRequestedBy) stopMine?.();
    }
    const onEvent = (event: SandboxEvent) => {
      if (event.type === "output") {
        if (pending.length < MAX_OUTPUT_LINES)
          pending.push({ stream: event.stream, text: event.text });
        timer ??= setTimeout(flush, batchMs);
      }
      if (event.type === "started") markStarted(doc, id);
      if (event.type === "end") finish(event);
    };

    // until the program reaches the sandbox, stopping just ends the run
    stopMine = () => finish({ type: "end", outcome: "stopped" });
    runs.observeDeep(watch);
    prepare(language, file, files).then(
      (job) => {
        if (!finished) stopMine = sandbox(job, onEvent);
      },
      (error: Error) => finish({ type: "end", outcome: "failed", error: error.message }),
    );
    return true;
  }

  return { run, dispose: () => stopMine?.() };
}
