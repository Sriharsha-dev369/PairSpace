import type * as Y from "yjs";
import type { RoomFile } from "../room/files";
import {
  addOutput,
  type Chunk,
  currentRun,
  endRun,
  type Language,
  MAX_OUTPUT_LINES,
  runStatus,
  startRun,
} from "./runState";
import { type Job, runInSandbox, type SandboxEvent } from "./sandbox";

export type Sandbox = (job: Job, onEvent: (event: SandboxEvent) => void) => () => void;

// how long a program may run before it's stopped (an endless loop, say)
const TIME_LIMIT_MS = 10_000;

const LANGUAGES: Record<string, Language> = { js: "javascript", mjs: "javascript" };

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

  function run(file: RoomFile): boolean {
    const language = runnableAs(file.name);
    const last = currentRun(doc);
    if (!language || (last && runStatus(last, present()) === "running")) return false;

    const id = startRun(doc, { file: file.name, language, by: me, runner: clientId });
    const runs = doc.getMap("run");
    let pending: Chunk[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      clearTimeout(timer);
      timer = undefined;
      if (pending.length > 0) addOutput(doc, id, pending);
      pending = [];
    };
    // someone asked to stop, or a run started at the same moment took this one's place
    const watch = () => {
      const now = currentRun(doc);
      if (now?.id !== id || now.stopRequestedBy) stopMine?.();
    };

    stopMine = sandbox(
      {
        language,
        modules: [{ path: file.name, source: file.content.toString(), imports: [] }],
        entry: file.name,
        timeLimitMs,
      },
      (event) => {
        if (event.type === "output") {
          if (pending.length < MAX_OUTPUT_LINES)
            pending.push({ stream: event.stream, text: event.text });
          timer ??= setTimeout(flush, batchMs);
        }
        if (event.type === "end") {
          runs.unobserveDeep(watch);
          stopMine = undefined;
          flush();
          endRun(doc, id, { status: event.outcome, error: event.error });
        }
      },
    );
    runs.observeDeep(watch);
    return true;
  }

  return { run, dispose: () => stopMine?.() };
}
