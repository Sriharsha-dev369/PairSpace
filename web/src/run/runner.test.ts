// Spec for the runner: what the browser of whoever pressed Run does. It starts the room's run,
// hands the program to the sandbox, writes what it prints into the room, and stops it when asked.
// A fake sandbox stands in for the real one (which needs a browser: see e2e/run.spec.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { RoomFile } from "../room/files";
import { createRunner, type Sandbox } from "./runner";
import { currentRun, requestStop, startRun } from "./runState";
import type { SandboxEvent } from "./sandbox";

const ada = { name: "Ada", color: "#f472b6" };
const bob = { name: "Bob", color: "#60a5fa" };

const file = (name: string, code = "console.log(1)"): RoomFile => {
  const content = new Y.Text();
  new Y.Doc().getMap("files").set("f", content); // a Y.Text must be in a document to be read
  content.insert(0, code);
  return { id: name, name, content, createdAt: 0 };
};

// a sandbox that runs nothing: the test says what the program printed and how it ended
function fakeSandbox() {
  const programs: { source: string; emit: (event: SandboxEvent) => void; stopped: boolean }[] = [];
  const sandbox: Sandbox = (job, emit) => {
    const program = { source: job.modules[0].source, emit, stopped: false };
    programs.push(program);
    return () => {
      program.stopped = true;
      emit({ type: "end", outcome: "stopped" });
    };
  };
  return { sandbox, programs };
}

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setUp(doc = new Y.Doc(), me = ada, clientId = 1, present = new Set([1, 2])) {
  const fake = fakeSandbox();
  const runner = createRunner({ doc, me, clientId, present: () => present, sandbox: fake.sandbox });
  return { doc, runner, ...fake };
}

describe("the runner", () => {
  it("runs the file and writes what it prints into the room, in batches", () => {
    const { doc, runner, programs } = setUp();
    let updates = 0;
    doc.on("update", () => updates++);

    expect(runner.run(file("main.js", "console.log('hi')"))).toBe(true);
    const before = updates;
    programs[0].emit({ type: "output", stream: "out", text: "one\n" });
    programs[0].emit({ type: "output", stream: "err", text: "two\n" });
    expect(currentRun(doc)?.output).toEqual([]);

    vi.advanceTimersByTime(50);

    expect(programs[0].source).toBe("console.log('hi')");
    expect(currentRun(doc)).toMatchObject({
      file: "main.js",
      language: "javascript",
      by: ada,
      runner: 1,
      output: [
        { stream: "out", text: "one\n" },
        { stream: "err", text: "two\n" },
      ],
    });
    expect(updates - before).toBe(1); // one change for both lines
  });

  it("says how the run ended, writing out what was printed first", () => {
    const { doc, runner, programs } = setUp();
    runner.run(file("main.js"));

    programs[0].emit({ type: "output", stream: "out", text: "last words\n" });
    programs[0].emit({ type: "end", outcome: "failed", error: "TypeError: nope" });

    expect(currentRun(doc)).toMatchObject({
      status: "failed",
      error: "TypeError: nope",
      output: [{ stream: "out", text: "last words\n" }],
    });
  });

  it("doesn't start while someone's run is going, but does once its browser has left", () => {
    const present = new Set([1, 2]);
    const { doc, runner, programs } = setUp(new Y.Doc(), ada, 1, present);
    startRun(doc, { file: "main.js", language: "javascript", by: bob, runner: 2 });

    expect(runner.run(file("main.js"))).toBe(false);
    expect(programs).toHaveLength(0);

    present.delete(2); // bob's tab closed mid-run
    expect(runner.run(file("main.js"))).toBe(true);
  });

  it("runs only files it knows how to run", () => {
    const { doc, runner } = setUp();

    expect(runner.run(file("README.md"))).toBe(false);
    expect(currentRun(doc)).toBeNull();
  });

  it("stops the program when anyone asks, and the run says who", () => {
    const { doc, runner, programs } = setUp();
    runner.run(file("main.js"));
    const id = currentRun(doc)?.id ?? "";

    requestStop(doc, id, "Bob");

    expect(programs[0].stopped).toBe(true);
    expect(currentRun(doc)).toMatchObject({ status: "stopped", stopRequestedBy: "Bob" });
  });

  it("stops its program when someone else's run started at the same moment wins", () => {
    const mine = setUp(new Y.Doc(), ada, 1);
    const theirs = setUp(new Y.Doc(), bob, 2);
    mine.runner.run(file("main.js"));
    theirs.runner.run(file("main.js"));

    sync(mine.doc, theirs.doc);

    const winner = currentRun(mine.doc)?.by.name;
    const loser = winner === "Ada" ? theirs : mine;
    expect(loser.programs[0].stopped).toBe(true);
    expect((winner === "Ada" ? mine : theirs).programs[0].stopped).toBe(false);
    expect(currentRun(mine.doc)?.status).toBe("running"); // the loser's ending goes nowhere
  });

  it("stops its program when this browser leaves the room", () => {
    const { runner, programs } = setUp();
    runner.run(file("main.js"));

    runner.dispose();

    expect(programs[0].stopped).toBe(true);
  });
});
