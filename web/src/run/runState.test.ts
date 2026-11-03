// Spec for a room's run as everyone sees it: kept in the room's shared document, so output reaches
// everyone and stays for whoever comes later. Two in-memory documents stand in for two people.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  addOutput,
  currentRun,
  endRun,
  MAX_OUTPUT_CHARS,
  MAX_OUTPUT_LINES,
  requestStop,
  runStatus,
  startRun,
} from "./runState";

const ada = { name: "Ada", color: "#f472b6" };
const bob = { name: "Bob", color: "#60a5fa" };

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

const start = (doc: Y.Doc, by = ada, runner = 1) =>
  startRun(doc, { file: "main.js", language: "javascript", by, runner, at: 1000 });

const printed = (doc: Y.Doc) =>
  currentRun(doc)
    ?.output.map((chunk) => chunk.text)
    .join("");

describe("a room's run", () => {
  it("reaches everyone: who ran which file, and what it printed, in order", () => {
    const [mine, theirs] = [new Y.Doc(), new Y.Doc()];
    const id = start(mine);

    addOutput(mine, id, [{ stream: "out", text: "one\n" }]);
    addOutput(mine, id, [
      { stream: "err", text: "two\n" },
      { stream: "out", text: "three\n" },
    ]);
    sync(mine, theirs);

    expect(currentRun(theirs)).toMatchObject({
      id,
      file: "main.js",
      by: ada,
      status: "running",
      output: [
        { stream: "out", text: "one\n" },
        { stream: "err", text: "two\n" },
        { stream: "out", text: "three\n" },
      ],
    });
  });

  it("stays, ended, for someone who opens the room later", () => {
    const doc = new Y.Doc();
    const id = start(doc);
    addOutput(doc, id, [{ stream: "out", text: "hi\n" }]);
    endRun(doc, id, { status: "done", at: 1400 });

    const later = new Y.Doc();
    Y.applyUpdate(later, Y.encodeStateAsUpdate(doc));

    expect(currentRun(later)).toMatchObject({ status: "done", endedAt: 1400 });
    expect(printed(later)).toBe("hi\n");
  });

  it("replaces the last run's output with the new run's", () => {
    const doc = new Y.Doc();
    const first = start(doc);
    addOutput(doc, first, [{ stream: "out", text: "old\n" }]);
    endRun(doc, first, { status: "done" });

    const second = start(doc, bob);

    expect(currentRun(doc)).toMatchObject({ id: second, by: bob, output: [] });
  });

  it("keeps one run for everyone when two people start one at the same moment", () => {
    const [mine, theirs] = [new Y.Doc(), new Y.Doc()];
    const myRun = start(mine, ada, 1);
    const theirRun = start(theirs, bob, 2);
    sync(mine, theirs);

    const winner = currentRun(mine)?.id;
    expect(currentRun(theirs)?.id).toBe(winner);
    expect([myRun, theirRun]).toContain(winner);

    // the other run's output and ending go nowhere: it isn't the room's run any more
    const loser = winner === myRun ? theirRun : myRun;
    addOutput(mine, loser, [{ stream: "out", text: "lost\n" }]);
    endRun(mine, loser, { status: "done" });
    expect(currentRun(mine)).toMatchObject({ id: winner, status: "running", output: [] });
  });

  it("ends once: a later ending doesn't change how it ended", () => {
    const doc = new Y.Doc();
    const id = start(doc);

    endRun(doc, id, { status: "stopped" });
    endRun(doc, id, { status: "done" });
    addOutput(doc, id, [{ stream: "out", text: "after the end\n" }]);

    expect(currentRun(doc)).toMatchObject({ status: "stopped", output: [] });
  });

  it("tells the runner's browser that someone asked to stop, and who", () => {
    const [runner, other] = [new Y.Doc(), new Y.Doc()];
    const id = start(runner);
    sync(runner, other);

    requestStop(other, id, "Bob");
    sync(runner, other);

    expect(currentRun(runner)?.stopRequestedBy).toBe("Bob");
  });

  it("keeps the first lines up to its limit, and says the rest was cut", () => {
    const doc = new Y.Doc();
    const id = start(doc);

    addOutput(
      doc,
      id,
      Array.from({ length: MAX_OUTPUT_LINES + 50 }, (_, i) => ({ stream: "out", text: `${i}\n` })),
    );

    const run = currentRun(doc);
    expect(run?.output).toHaveLength(MAX_OUTPUT_LINES);
    expect(run?.output.at(-1)?.text).toBe(`${MAX_OUTPUT_LINES - 1}\n`);
    expect(run?.truncated).toBe(true);
  });

  it("cuts output at its size limit too, even inside one long line", () => {
    const doc = new Y.Doc();
    const id = start(doc);

    addOutput(doc, id, [{ stream: "out", text: "x".repeat(MAX_OUTPUT_CHARS + 10) }]);
    expect(currentRun(doc)?.truncated).toBe(true);
    addOutput(doc, id, [{ stream: "out", text: "more\n" }]);

    expect(printed(doc)).toBe("x".repeat(MAX_OUTPUT_CHARS));
    expect(currentRun(doc)?.truncated).toBe(true);
  });
});

describe("how a run shows", () => {
  it("is running while the browser running it is in the room, interrupted once it has left", () => {
    const doc = new Y.Doc();
    start(doc, ada, 7);
    const run = currentRun(doc);
    if (!run) throw new Error("no run");

    expect(runStatus(run, new Set([7, 8]))).toBe("running");
    expect(runStatus(run, new Set([8]))).toBe("interrupted");
  });

  it("keeps how it ended, whoever is in the room", () => {
    const doc = new Y.Doc();
    const id = start(doc, ada, 7);
    endRun(doc, id, { status: "timed-out" });
    const run = currentRun(doc);
    if (!run) throw new Error("no run");

    expect(runStatus(run, new Set())).toBe("timed-out");
  });
});
