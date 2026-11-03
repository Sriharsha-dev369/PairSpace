// Spec for who wrote what, in replay: every character is credited to whoever's change added it,
// worked out from the saved changes themselves. And the pace of playing them back.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { authorsOf, LONG_PAUSE_MS, PAUSE_SHOWN_MS, playbackDelay, runsOf } from "./authors";
import { createTimeline, type Step } from "./timeline";

// what saving does: each person's changes become steps, with who made them
function record() {
  const steps: Step[] = [];
  const watch = (doc: Y.Doc, author: string | null, authorId: string | null = null) =>
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== "sync") steps.push({ at: steps.length, author, authorId, update });
    });
  return { steps, watch };
}

const sync = (from: Y.Doc, to: Y.Doc) =>
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), "sync");

// the text's runs as [text, who]
const credits = (steps: Step[]) => {
  const timeline = createTimeline(steps);
  const doc = timeline.docAt(timeline.size - 1);
  return runsOf(doc.getText("code"), authorsOf(steps)).map((run) => [
    run.text,
    run.author?.name ?? null,
  ]);
};

describe("who wrote what", () => {
  it("credits each part of the text to whoever typed it", () => {
    const { steps, watch } = record();
    const [ada, bob] = [new Y.Doc(), new Y.Doc()];
    watch(ada, "Ada");
    watch(bob, "Bob");

    ada.getText("code").insert(0, "hello ");
    sync(ada, bob);
    bob.getText("code").insert(6, "world");
    sync(bob, ada);
    ada.getText("code").insert(6, "big ");

    expect(credits(steps)).toEqual([
      ["hello big ", "Ada"],
      ["world", "Bob"],
    ]);
  });

  it("leaves out deleted text, and credits the room's own text to nobody", () => {
    const { steps, watch } = record();
    const [server, ada] = [new Y.Doc(), new Y.Doc()];
    watch(server, null);
    watch(ada, "Ada");

    server.getText("code").insert(0, "// start\n");
    sync(server, ada);
    ada.getText("code").insert(9, "let x = 1;");
    ada.getText("code").delete(0, 3); // "// " removed

    expect(credits(steps)).toEqual([
      ["start\n", null],
      ["let x = 1;", "Ada"],
    ]);
  });

  it("leaves out deleted text even in a document that keeps it (for undo, say)", () => {
    const doc = new Y.Doc({ gc: false });
    const text = doc.getText("code");
    text.insert(0, "keep, not this");
    text.delete(4, 10);
    const authors = new Map([[doc.clientID, { key: "ada", name: "Ada", color: "#f472b6" }]]);

    expect(runsOf(text, authors).map((run) => run.text)).toEqual(["keep"]);
  });

  // a browser that reconnects sends everything it has that the server lacks, others' edits too
  it("keeps crediting text to whoever typed it when someone else's browser sends it again", () => {
    const { steps, watch } = record();
    const [ada, bob] = [new Y.Doc(), new Y.Doc()];
    watch(ada, "Ada");
    ada.getText("code").insert(0, "ada's line");
    sync(ada, bob);

    steps.push({
      at: steps.length,
      author: "Bob",
      authorId: null,
      update: Y.encodeStateAsUpdate(bob),
    });

    expect(credits(steps)).toEqual([["ada's line", "Ada"]]);
  });

  it("gives each person one colour: members by account, guests by the name they showed", () => {
    const { steps, watch } = record();
    const [tab, otherTab, guest] = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
    watch(tab, "Ada", "user-ada");
    watch(otherTab, "Ada Lovelace", "user-ada"); // the same member, another tab, renamed since
    watch(guest, "Swift Otter");
    tab.getText("code").insert(0, "a");
    otherTab.getText("code").insert(0, "b");
    guest.getText("code").insert(0, "c");

    const authors = authorsOf(steps);
    const [mine, again, theirs] = [tab, otherTab, guest].map((doc) => authors.get(doc.clientID));

    expect(mine?.color).toBe(again?.color);
    expect(mine?.key).toBe(again?.key);
    expect(theirs?.key).not.toBe(mine?.key);
    expect(theirs?.color).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("playing back", () => {
  it("goes at the pace it was typed, with long pauses cut short", () => {
    const steps = [0, 400, 900, 900 + LONG_PAUSE_MS + 1, 900 + LONG_PAUSE_MS + 301].map(
      (at): Step => ({ at, author: "Ada", authorId: null, update: new Uint8Array() }),
    );

    expect([0, 1, 2, 3].map((step) => playbackDelay(steps, step))).toEqual([
      400,
      500,
      PAUSE_SHOWN_MS,
      300,
    ]);
  });
});
