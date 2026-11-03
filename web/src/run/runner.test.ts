// Spec for the runner: what the browser of whoever pressed Run does. It starts the room's run,
// hands the program to the sandbox, writes what it prints into the room, and stops it when asked.
// A fake sandbox stands in for the real one (which needs a browser: see e2e/run.spec.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { RoomFile } from "../room/files";
import { createRunner, type Sandbox } from "./runner";
import { currentRun, requestStop, startRun } from "./runState";
import type { Job, SandboxEvent } from "./sandbox";

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
  const programs: {
    source: string;
    modules: Job["modules"];
    emit: (event: SandboxEvent) => void;
    stopped: boolean;
  }[] = [];
  const sandbox: Sandbox = (job, emit) => {
    const program = {
      source: job.modules.at(-1)?.source ?? "",
      modules: job.modules,
      emit,
      stopped: false,
    };
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

// the program reaches the sandbox once it's put together (a moment later)
const reached = (programs: unknown[], count = 1) =>
  vi.waitFor(() => expect(programs).toHaveLength(count));
afterEach(() => vi.useRealTimers());

function setUp(doc = new Y.Doc(), me = ada, clientId = 1, present = new Set([1, 2])) {
  const fake = fakeSandbox();
  const runner = createRunner({ doc, me, clientId, present: () => present, sandbox: fake.sandbox });
  return { doc, runner, ...fake };
}

describe("the runner", () => {
  it("runs the file and writes what it prints into the room, in batches", async () => {
    const { doc, runner, programs } = setUp();
    let updates = 0;
    doc.on("update", () => updates++);

    const main = file("main.js", "console.log('hi')");
    expect(runner.run(main, [main])).toBe(true);
    await reached(programs);
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

  it("says how the run ended, writing out what was printed first", async () => {
    const { doc, runner, programs } = setUp();
    const main = file("main.js");
    runner.run(main, [main]);
    await reached(programs);

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

    const main = file("main.js");
    expect(runner.run(main, [main])).toBe(false);
    expect(programs).toHaveLength(0);

    present.delete(2); // bob's tab closed mid-run
    expect(runner.run(main, [main])).toBe(true);
  });

  it("runs only files it knows how to run", () => {
    const { doc, runner } = setUp();

    const readme = file("README.md");
    expect(runner.run(readme, [readme])).toBe(false);
    expect(currentRun(doc)).toBeNull();
  });

  it("stops the program when anyone asks, and the run says who", async () => {
    const { doc, runner, programs } = setUp();
    const main = file("main.js");
    runner.run(main, [main]);
    await reached(programs);
    const id = currentRun(doc)?.id ?? "";

    requestStop(doc, id, "Bob");

    expect(programs[0].stopped).toBe(true);
    expect(currentRun(doc)).toMatchObject({ status: "stopped", stopRequestedBy: "Bob" });
  });

  it("stops its program when someone else's run started at the same moment wins", async () => {
    const mine = setUp(new Y.Doc(), ada, 1);
    const theirs = setUp(new Y.Doc(), bob, 2);
    const main = file("main.js");
    mine.runner.run(main, [main]);
    theirs.runner.run(main, [main]);
    await reached(mine.programs);
    await reached(theirs.programs);

    sync(mine.doc, theirs.doc);

    const winner = currentRun(mine.doc)?.by.name;
    const loser = winner === "Ada" ? theirs : mine;
    expect(loser.programs[0].stopped).toBe(true);
    expect((winner === "Ada" ? mine : theirs).programs[0].stopped).toBe(false);
    expect(currentRun(mine.doc)?.status).toBe("running"); // the loser's ending goes nowhere
  });

  it("stops its program when this browser leaves the room", async () => {
    const { runner, programs } = setUp();
    const main = file("main.js");
    runner.run(main, [main]);
    await reached(programs);

    runner.dispose();

    expect(programs[0].stopped).toBe(true);
  });

  it("hands the sandbox the open file with the room files it imports, in order", async () => {
    const { runner, programs } = setUp();
    const main = file("main.js", 'import { twice } from "./utils.js";\nconsole.log(twice(2));');
    const utils = file("utils.js", "export const twice = (n) => n * 2;");

    runner.run(main, [main, utils, file("other.js")]);

    await reached(programs);
    expect(programs[0].modules.map((module) => module.path)).toEqual(["utils.js", "main.js"]);
  });

  it("ends the run with the reason when the program can't be put together", async () => {
    const { doc, runner, programs } = setUp();
    const main = file("main.js", 'import "./missing.js";');

    runner.run(main, [main]);

    await vi.waitFor(() => expect(currentRun(doc)?.status).toBe("failed"));
    expect(currentRun(doc)?.error).toBe("Can't find './missing.js', imported by main.js.");
    expect(programs).toHaveLength(0);
  });

  it("ends the run if someone stops it while it's being put together", async () => {
    const { doc, runner, programs } = setUp();
    const main = file("main.js");
    runner.run(main, [main]);

    requestStop(doc, currentRun(doc)?.id ?? "", "Bob");

    expect(currentRun(doc)).toMatchObject({ status: "stopped", stopRequestedBy: "Bob" });
    await vi.advanceTimersByTimeAsync(100);
    expect(programs).toHaveLength(0);
  });
});
