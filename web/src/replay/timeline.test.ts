// Spec for replay's engine (M8's done-when): the room at any step of its history is exactly the
// room as it was then. The expected rooms are written out by hand, from the edits made.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createFile, deleteFile, listFiles, renameFile } from "../room/files";
import { createTimeline, parseHistory, type Step } from "./timeline";

// what saving does: every change a person makes becomes a step, with who made it and when
function record() {
  const steps: Step[] = [];
  let clock = 1_000;
  const watch = (doc: Y.Doc, author: string | null) =>
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== "sync") steps.push({ at: clock++, author, authorId: null, update });
    });
  return { steps, watch };
}

const sync = (from: Y.Doc, to: Y.Doc) =>
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), "sync");

// the room's files as { name: text }
const room = (doc: Y.Doc) =>
  Object.fromEntries(listFiles(doc).map((file) => [file.name, file.content.toString()]));

describe("replaying a room", () => {
  it("rebuilds the room exactly as it was after each change", () => {
    const { steps, watch } = record();
    const server = new Y.Doc();
    const [ada, bob] = [new Y.Doc(), new Y.Doc()];
    watch(server, null);
    watch(ada, "Ada");
    watch(bob, "Bob");
    const text = (doc: Y.Doc) => listFiles(doc)[0].content;

    // the server makes the room's first file; everyone gets it
    server.transact(() => {
      const file = new Y.Map<unknown>();
      file.set("name", "main.js");
      file.set("content", new Y.Text());
      server.getMap("files").set("first", file);
    });
    sync(server, ada);
    sync(server, bob);
    text(ada).insert(0, "hello");
    sync(ada, bob);
    text(bob).insert(5, " world");
    sync(bob, ada);
    text(ada).delete(0, 6);
    sync(ada, bob);
    const utils = createFile(bob, "utils.js");
    sync(bob, ada);
    renameFile(ada, "first", "index.js");
    sync(ada, bob);
    deleteFile(bob, utils, "Bob");

    const timeline = createTimeline(steps);

    const expected = [
      { "main.js": "" },
      { "main.js": "hello" },
      { "main.js": "hello world" },
      { "main.js": "world" },
      { "main.js": "world", "utils.js": "" },
      { "index.js": "world", "utils.js": "" },
      { "index.js": "world" },
    ];
    expect(timeline.size).toBe(expected.length);
    expected.forEach((files, step) => {
      expect(room(timeline.docAt(step)), `step ${step}`).toEqual(files);
    });
    expect(steps.map((step) => step.author)).toEqual([
      null,
      "Ada",
      "Bob",
      "Ada",
      "Bob",
      "Ada",
      "Bob",
    ]);
  });

  it("gives the same room at a step whichever step it jumps from, in a long history", () => {
    const { steps, watch } = record();
    const doc = new Y.Doc();
    watch(doc, "Ada");
    const text = doc.getText("probe");
    for (let i = 0; i < 130; i++) text.insert(i, "a"); // more steps than between checkpoints

    const timeline = createTimeline(steps);

    for (const step of [129, 3, 77, 50, 49, 0, 100, 129, 64]) {
      expect(timeline.docAt(step).getText("probe").toString(), `step ${step}`).toBe(
        "a".repeat(step + 1),
      );
    }
  });
});

describe("the saved history", () => {
  it("is read from the server's answer: the change's bytes, who made it, and when", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const [step] = parseHistory([
      {
        at: "2026-11-03T10:00:00.000Z",
        author: "Ada",
        authorId: "user-1",
        update: Buffer.from(bytes).toString("base64"),
      },
    ]);

    expect(step).toEqual({
      at: Date.parse("2026-11-03T10:00:00.000Z"),
      author: "Ada",
      authorId: "user-1",
      update: bytes,
    });
  });
});
