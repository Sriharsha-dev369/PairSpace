// Spec for the room store: how rooms are saved to and loaded from Postgres.
// Runs against the real test database; every test uses a fresh room name.

import { afterAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { connect } from "../src/db";
import { openRoomStore } from "../src/room-store";
import { users } from "../src/schema";
import { TEST_DATABASE_URL } from "./database";

const store = openRoomStore(TEST_DATABASE_URL);
const { db, pool } = connect(TEST_DATABASE_URL); // to add accounts, which the store doesn't do
afterAll(async () => {
  await store.close();
  await pool.end();
});

// a fresh room, created as the dashboard would (no first file unless given)
async function newRoom(ownerId: string | null = null, state?: Uint8Array) {
  const id = `room-${crypto.randomUUID()}`;
  await store.createRoom(id, { ownerId, title: "Test room", state });
  return id;
}

async function newAccount() {
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, name: "Someone", email: `${id}@example.com` });
  return id;
}

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
      return store.append(room, [{ update: change, author: null, authorId: null }]);
    },
  };
}

describe("room store", () => {
  it("has nothing for a room that was never saved", async () => {
    expect(await store.load(`room-${crypto.randomUUID()}`)).toBeNull();
  });

  it("loads back the changes saved for a room", async () => {
    const room = await newRoom();
    for (const update of changesTyping("hello", " world")) {
      await store.append(room, [{ update, author: "Alice", authorId: null }]);
    }

    expect(await loadText(room)).toBe("hello world");
  });

  it("keeps every change with its author and time, oldest first", async () => {
    const room = await newRoom();
    const [a, b, c] = changesTyping("a", "b", "c");
    await store.append(room, [{ update: a, author: "Alice", authorId: null }]);
    await store.append(room, [
      { update: b, author: null, authorId: null },
      { update: c, author: "Bob", authorId: null },
    ]);

    const history = await store.history(room);

    expect(history.map((h) => h.author)).toEqual(["Alice", null, "Bob"]);
    expect(history.map((h) => [...h.update])).toEqual([[...a], [...b], [...c]]);
    for (const { at } of history) expect(Math.abs(at.getTime() - Date.now())).toBeLessThan(5000);
  });

  it("keeps rooms apart", async () => {
    const [first, second] = [await newRoom(), await newRoom()];
    const [a] = changesTyping("only in the first");
    const [b] = changesTyping("only in the second");
    await store.append(first, [{ update: a, author: null, authorId: null }]);
    await store.append(second, [{ update: b, author: null, authorId: null }]);

    expect(await loadText(first)).toBe("only in the first");
    expect(await loadText(second)).toBe("only in the second");
  });

  it("loads from the latest snapshot plus only the changes after it", async () => {
    const room = await newRoom();
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
    const room = await newRoom();
    const typing = savedTyping(room);
    await typing.type("a");
    const upTo = await typing.type("b");

    await store.snapshot(room, Y.encodeStateAsUpdate(typing.doc), upTo);

    expect(await store.history(room)).toHaveLength(2);
  });
});

describe("rooms and their owners", () => {
  it("creates a room with its owner, title and first file", async () => {
    const owner = await newAccount();
    const [firstFile] = changesTyping("the first file");
    const id = `room-${crypto.randomUUID()}`;

    await store.createRoom(id, { ownerId: owner, title: "Plans", state: firstFile });

    expect(await loadText(id)).toBe("the first file");
    expect(await store.listRooms(owner)).toEqual([expect.objectContaining({ id, title: "Plans" })]);
  });

  it("lists an owner's rooms, most recently edited first", async () => {
    const [owner, someoneElse] = [await newAccount(), await newAccount()];
    const older = await newRoom(owner);
    const newer = await newRoom(owner);
    await newRoom(someoneElse);
    const ids = async () => (await store.listRooms(owner)).map((room) => room.id);
    expect(await ids()).toEqual([newer, older]);

    const [edit] = changesTyping("an edit");
    await store.append(older, [{ update: edit, author: null, authorId: null }]);

    expect(await ids()).toEqual([older, newer]);
  });

  it("renames a room only for its owner", async () => {
    const [owner, someoneElse] = [await newAccount(), await newAccount()];
    const id = await newRoom(owner);

    expect(await store.renameRoom(id, someoneElse, "Hijacked")).toBe(false);
    expect(await store.renameRoom(id, owner, "Renamed")).toBe(true);
    expect((await store.listRooms(owner))[0].title).toBe("Renamed");
  });

  it("deletes a room and its whole history, only for its owner", async () => {
    const [owner, someoneElse] = [await newAccount(), await newAccount()];
    const [firstFile] = changesTyping("some work");
    const id = await newRoom(owner, firstFile);

    expect(await store.deleteRoom(id, someoneElse)).toBe(false);
    expect(await loadText(id)).toBe("some work");
    expect(await store.deleteRoom(id, owner)).toBe(true);
    expect(await store.load(id)).toBeNull();
    expect(await store.history(id)).toEqual([]);
  });

  // a write still in flight when the owner deletes the room must not recreate it
  it("never brings back a deleted room", async () => {
    const owner = await newAccount();
    const id = await newRoom(owner);
    await store.deleteRoom(id, owner);
    const [late] = changesTyping("arrived after the delete");

    await expect(
      store.append(id, [{ update: late, author: null, authorId: null }]),
    ).rejects.toThrow();
    expect(await store.load(id)).toBeNull();
  });
});
