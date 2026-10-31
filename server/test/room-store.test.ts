// Spec for the room store: how rooms are saved to and loaded from Postgres.
// Runs against the real test database; every test uses a fresh room name.

import { afterAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { openRoomStore } from "../src/room-store";
import { TEST_DATABASE_URL } from "./database";

const store = openRoomStore(TEST_DATABASE_URL);
afterAll(() => store.close());

const newRoom = () => `room-${crypto.randomUUID()}`;

// the Yjs changes made by typing each string in turn into one document
function changesTyping(...parts: string[]): Uint8Array[] {
  const doc = new Y.Doc();
  const changes: Uint8Array[] = [];
  doc.on("update", (update: Uint8Array) => changes.push(update));
  for (const part of parts) doc.getText("t").insert(doc.getText("t").length, part);
  return changes;
}

function textOf(state: Uint8Array) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc.getText("t").toString();
}

async function loadText(room: string) {
  const loaded = await store.load(room);
  return loaded && textOf(loaded.state);
}

// a document whose every typed part is saved as it happens; returns each write's position
function savedTyping(room: string) {
  const doc = new Y.Doc();
  const text = doc.getText("t");
  return {
    doc,
    type(part: string) {
      let change: Uint8Array = new Uint8Array();
      doc.once("update", (update: Uint8Array) => {
        change = update;
      });
      text.insert(text.length, part);
      return store.append(room, [{ update: change, author: null }]);
    },
  };
}

describe("room store", () => {
  it("has nothing for a room that was never saved", async () => {
    expect(await store.load(newRoom())).toBeNull();
  });

  it("loads back the changes saved for a room", async () => {
    const room = newRoom();
    for (const update of changesTyping("hello", " world")) {
      await store.append(room, [{ update, author: "Alice" }]);
    }

    expect(await loadText(room)).toBe("hello world");
  });

  it("keeps every change with its author and time, oldest first", async () => {
    const room = newRoom();
    const [a, b, c] = changesTyping("a", "b", "c");
    await store.append(room, [{ update: a, author: "Alice" }]);
    await store.append(room, [
      { update: b, author: null },
      { update: c, author: "Bob" },
    ]);

    const history = await store.history(room);

    expect(history.map((h) => h.author)).toEqual(["Alice", null, "Bob"]);
    expect(history.map((h) => [...h.update])).toEqual([[...a], [...b], [...c]]);
    for (const { at } of history) expect(Math.abs(at.getTime() - Date.now())).toBeLessThan(5000);
  });

  it("keeps rooms apart", async () => {
    const [first, second] = [newRoom(), newRoom()];
    const [a] = changesTyping("only in the first");
    const [b] = changesTyping("only in the second");
    await store.append(first, [{ update: a, author: null }]);
    await store.append(second, [{ update: b, author: null }]);

    expect(await loadText(first)).toBe("only in the first");
    expect(await loadText(second)).toBe("only in the second");
  });

  it("loads from the latest snapshot plus only the changes after it", async () => {
    const room = newRoom();
    const typing = savedTyping(room);
    await typing.type("a");
    const upTo = await typing.type("b");
    await store.snapshot(room, Y.encodeStateAsUpdate(typing.doc), upTo);
    await typing.type("c");

    const loaded = await store.load(room);

    expect(loaded?.replayed).toBe(1); // only "c": "a" and "b" came with the snapshot
    expect(loaded && textOf(loaded.state)).toBe("abc");
  });

  it("keeps the full history when a snapshot is taken", async () => {
    const room = newRoom();
    const typing = savedTyping(room);
    await typing.type("a");
    const upTo = await typing.type("b");

    await store.snapshot(room, Y.encodeStateAsUpdate(typing.doc), upTo);

    expect(await store.history(room)).toHaveLength(2);
  });
});
