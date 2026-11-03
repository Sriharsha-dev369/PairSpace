import * as Y from "yjs";
import { randomId } from "../room/randomId";

// in the room's document: run = Y.Map{ current: Y.Map }, the room's latest run. Starting a run
// replaces it, so two runs started at the same moment end as one, the same for everyone

export type Language = "javascript" | "python";
export type RunStatus = "running" | "done" | "failed" | "stopped" | "timed-out";

export interface Chunk {
  stream: "out" | "err";
  text: string;
}

export interface RunView {
  id: string;
  file: string; // its name when the run started
  language: Language;
  by: { name: string; color: string }; // who pressed Run
  runner: number; // the presence id of the browser running it
  startedAt: number;
  endedAt?: number;
  status: RunStatus;
  starting: boolean; // still loading its language (Python takes a few seconds), not yet running
  error?: string; // why it failed
  stopRequestedBy?: string;
  truncated: boolean; // output past the limits was dropped
  output: Chunk[];
}

// the output is saved with the room for good, so a print loop mustn't fill it
export const MAX_OUTPUT_LINES = 2000;
export const MAX_OUTPUT_CHARS = 100_000;

const current = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>("run").get("current");

// the run with this id, if it's the room's run and hasn't ended
function running(doc: Y.Doc, id: string) {
  const run = current(doc);
  return run?.get("id") === id && run.get("status") === "running" ? run : undefined;
}

export function currentRun(doc: Y.Doc): RunView | null {
  const run = current(doc);
  if (!run) return null;
  const { output, ...fields } = run.toJSON() as Omit<RunView, "truncated" | "starting"> & {
    truncated?: boolean;
    starting?: boolean;
  };
  return {
    ...fields,
    starting: fields.starting ?? false,
    truncated: fields.truncated ?? false,
    output,
  };
}

export function startRun(
  doc: Y.Doc,
  run: { file: string; language: Language; by: RunView["by"]; runner: number; at?: number },
): string {
  const id = randomId(16);
  const fields = new Y.Map<unknown>();
  fields.set("id", id);
  fields.set("file", run.file);
  fields.set("language", run.language);
  fields.set("by", run.by);
  fields.set("runner", run.runner);
  fields.set("startedAt", run.at ?? Date.now());
  fields.set("status", "running" satisfies RunStatus);
  fields.set("starting", run.language === "python");
  fields.set("output", new Y.Array<Chunk>());
  doc.getMap("run").set("current", fields);
  return id;
}

// adds what the run printed, up to the limits; ignored once the run has ended or been replaced
export function addOutput(doc: Y.Doc, id: string, chunks: Chunk[]) {
  const run = running(doc, id);
  if (!run) return;
  const output = run.get("output") as Y.Array<Chunk>;
  let lines = output.length;
  let size = output.toArray().reduce((total, chunk) => total + chunk.text.length, 0);
  const kept: Chunk[] = [];
  let cut = false;
  for (const chunk of chunks) {
    const room = MAX_OUTPUT_CHARS - size;
    if (lines >= MAX_OUTPUT_LINES || room <= 0) {
      cut = true;
      break;
    }
    const text = chunk.text.slice(0, room);
    if (text.length < chunk.text.length) cut = true;
    kept.push({ stream: chunk.stream, text });
    lines += 1;
    size += text.length;
  }
  doc.transact(() => {
    if (kept.length > 0) output.push(kept);
    if (cut) run.set("truncated", true);
  });
}

export function endRun(
  doc: Y.Doc,
  id: string,
  end: { status: Exclude<RunStatus, "running">; error?: string; at?: number },
) {
  const run = running(doc, id);
  if (!run) return;
  doc.transact(() => {
    run.set("status", end.status);
    run.set("endedAt", end.at ?? Date.now());
    if (end.error) run.set("error", end.error);
  });
}

// the language has loaded and the program has begun
export function markStarted(doc: Y.Doc, id: string) {
  running(doc, id)?.set("starting", false);
}

// the runner's browser sees this and stops the program
export function requestStop(doc: Y.Doc, id: string, by: string) {
  running(doc, id)?.set("stopRequestedBy", by);
}

// as people see it: a run whose browser has left the room was interrupted, whatever it says
export function runStatus(run: RunView, present: Set<number>): RunStatus | "interrupted" {
  return run.status === "running" && !present.has(run.runner) ? "interrupted" : run.status;
}
