import type { IncomingMessage, Server } from "node:http";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { WebSocket, WebSocketServer } from "ws";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { newRoomDocument } from "./room-document";

export interface SyncServer {
  port: number;
  roomCount(): number;
  // the room was deleted: everyone in it is told (4410) and it's forgotten, unsaved changes too
  dropRoom(name: string): Promise<void>;
  close(): Promise<void>;
}

export interface StoredChange {
  update: Uint8Array;
  author: string | null; // the name shown at the time; null for the server's own changes
  authorId: string | null; // the member's user id; null for guests and the server
}

// a signed-in member, as verified from their session
export interface Member {
  id: string;
  name: string;
}

export type Role = "owner" | "editor" | "viewer";

// who may enter a room and as what, decided before the room is loaded
export type Admission =
  | { member: Member | null; role: Role } // member null: a guest
  | { refused: "no-room" | "no-access" };

export interface LoadedRoom {
  state: Uint8Array; // the latest snapshot merged with every change after it
  replayed: number; // how many changes came after the snapshot
}

// where rooms are saved (Postgres in production); without one, rooms live only in memory
export interface RoomStore {
  load(room: string): Promise<LoadedRoom | null>; // null if never saved
  append(room: string, changes: StoredChange[]): Promise<number>; // position of the last one
  // state must include every change up to `upTo`; extra later changes are harmless
  snapshot(room: string, state: Uint8Array, upTo: number): Promise<void>;
}

interface Options {
  port?: number; // 0 = let the OS pick a free port (used by tests)
  server?: Server; // instead of a port: share an existing HTTP server's
  store?: RoomStore;
  // who a connection belongs to and what it may do, from its upgrade request (session cookie,
  // share link). Without it (tests), everyone is a guest editor
  admit?: (request: IncomingMessage, room: string) => Promise<Admission>;
  heartbeatMs?: number;
  saveDelayMs?: number;
  snapshotEvery?: number;
  unloadAfterMs?: number;
  maxMessageBytes?: number;
  log?: (line: string) => void;
}

interface Room {
  doc: Y.Doc; // the server's copy, so late joiners can sync even when nobody else is online
  awareness: awarenessProtocol.Awareness; // live presence (names, cursors), never saved
  conns: Set<WebSocket>;
  presenceOf: Map<WebSocket, Set<number>>; // the awareness client ids each connection owns
  memberOf: Map<WebSocket, Member>; // signed-in connections; the rest are guests
  unsaved: StoredChange[]; // changes waiting for the next write
  saveTimer?: ReturnType<typeof setTimeout>;
  saving: Promise<void>; // the latest write: each waits for the one before, so rows stay in order
  sinceSnapshot: number; // changes written since the last snapshot
  unloadTimer?: ReturnType<typeof setTimeout>;
  dropped: boolean; // deleted: nothing more is saved, and nobody else is let in
}

interface AwarenessChanges {
  added: number[];
  updated: number[];
  removed: number[];
}

// message types of the y-websocket protocol
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

// y-websocket clients never retry after a close code in 4400-4499, so permanent rejections use it
const CLOSE_INVALID_ROOM = 4400;
const CLOSE_MALFORMED = 1007; // standard WebSocket code for "invalid payload data"
const CLOSE_TRY_AGAIN = 1011; // standard "server error": clients retry it
const CLOSE_NO_ROOM = 4404; // no such room (rooms are created from the dashboard, not by opening one)
const CLOSE_NO_ACCESS = 4403; // the room exists, but you need a share link (or to be its owner)
const CLOSE_DELETED = 4410; // the owner deleted the room while you were in it

// y-websocket clients drop a connection they hear nothing on for 30s, so beat well inside that
const HEARTBEAT_MS = 10_000;

// changes wait at most this long to be written; open tabs re-send anything a crash loses meanwhile
const SAVE_DELAY_MS = 500;

// rows written between snapshots (about 50s of one person typing): loading replays at most this many
const SNAPSHOT_EVERY = 100;

// how long an empty room stays in memory: a reload or a blip reconnects well within it
const UNLOAD_AFTER_MS = 30_000;
// an awareness message (type, payload length 1) listing zero people: clients apply it as a no-op
const KEEPALIVE = new Uint8Array([MESSAGE_AWARENESS, 1, 0]);

// the biggest legit message is a whole room re-sent after the server lost it; refuse more (1009)
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;

// a guest's name comes from their browser, so it's capped before it's saved
const MAX_GUEST_NAME = 64;

// the room name comes from the URL, which the client controls, so restrict it
const ROOM_NAME = /^[A-Za-z0-9_-]{1,64}$/;

// one row per person per batch: replay still knows who wrote what, without a row per keystroke
function mergeByAuthor(changes: StoredChange[]): StoredChange[] {
  const byAuthor = new Map<string, { change: StoredChange; updates: Uint8Array[] }>();
  for (const change of changes) {
    const key = JSON.stringify([change.authorId, change.author]);
    const theirs = byAuthor.get(key);
    if (theirs) theirs.updates.push(change.update);
    else byAuthor.set(key, { change, updates: [change.update] });
  }
  return [...byAuthor.values()].map(({ change, updates }) => ({
    ...change,
    update: Y.mergeUpdates(updates),
  }));
}

function syncMessage(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

function awarenessMessage(awareness: awarenessProtocol.Awareness, clientIds: number[]) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(awareness, clientIds),
  );
  return encoding.toUint8Array(encoder);
}

export function createSyncServer({
  port,
  server,
  store,
  admit,
  heartbeatMs = HEARTBEAT_MS,
  saveDelayMs = SAVE_DELAY_MS,
  snapshotEvery = SNAPSHOT_EVERY,
  unloadAfterMs = UNLOAD_AFTER_MS,
  maxMessageBytes = MAX_MESSAGE_BYTES,
  log = () => {},
}: Options): Promise<SyncServer> {
  // ws checks a frame's declared length before reading it, so oversize messages are never buffered
  const wss = new WebSocketServer(
    server ? { server, maxPayload: maxMessageBytes } : { port, maxPayload: maxMessageBytes },
  );
  const rooms = new Map<string, Room>();
  const opening = new Map<string, Promise<unknown>>(); // the latest attempt to open each room
  const beats = new Map<WebSocket, () => void>(); // what each connection does on every heartbeat
  let nextId = 1;
  const note = (text: string) => log(`${new Date().toISOString()} ${text}`);

  const heartbeat = setInterval(() => {
    for (const beat of beats.values()) beat();
  }, heartbeatMs);

  function broadcast(room: Room, message: Uint8Array, except: unknown) {
    for (const conn of room.conns) {
      if (conn !== except && conn.readyState === WebSocket.OPEN) conn.send(message);
    }
  }

  function queueSave(name: string, room: Room, change: StoredChange) {
    if (!store || room.dropped) return;
    room.unsaved.push(change);
    room.saveTimer ??= setTimeout(() => flush(name, room), saveDelayMs);
  }

  // writes everything waiting, one row per person; a failed write is put back and retried
  function flush(name: string, room: Room): Promise<void> {
    clearTimeout(room.saveTimer);
    room.saveTimer = undefined;
    room.saving = room.saving.then(async () => {
      const changes = room.unsaved.splice(0);
      if (!store || changes.length === 0) return;
      const rows = mergeByAuthor(changes);
      let upTo: number;
      try {
        upTo = await store.append(name, rows);
      } catch (err) {
        note(`couldn't save "${name}", retrying: ${(err as Error).message}`);
        if (room.dropped) return; // deleted meanwhile: there's nothing to retry into
        room.unsaved.unshift(...changes);
        room.saveTimer ??= setTimeout(() => flush(name, room), saveDelayMs);
        return;
      }
      room.sinceSnapshot += rows.length;
      if (room.sinceSnapshot < snapshotEvery) return;
      // taken after the write, so it holds every change up to upTo (and maybe a few later ones)
      try {
        await store.snapshot(name, Y.encodeStateAsUpdate(room.doc), upTo);
        room.sinceSnapshot = 0;
      } catch (err) {
        // the changes are already saved; try again after the next write
        note(`couldn't snapshot "${name}": ${(err as Error).message}`);
      }
    });
    return room.saving;
  }

  // drops an empty room from memory once everything in it is written
  async function unload(name: string, room: Room) {
    room.unloadTimer = undefined;
    await flush(name, room);
    // someone may have joined while that write was in flight: dropping the room now would split it
    if (room.conns.size > 0 || rooms.get(name) !== room) return;
    rooms.delete(name);
    room.awareness.destroy();
    room.doc.destroy();
    note(`room "${name}" unloaded (${rooms.size} rooms)`);
  }

  // who made a change: a member as their session says, a guest by the name their presence shows
  function authorOf(room: Room, origin: unknown): Pick<StoredChange, "author" | "authorId"> {
    const member = room.memberOf.get(origin as WebSocket);
    if (member) return { author: member.name, authorId: member.id };
    for (const clientId of room.presenceOf.get(origin as WebSocket) ?? []) {
      const name = room.awareness.getStates().get(clientId)?.user?.name;
      if (typeof name === "string")
        return { author: name.slice(0, MAX_GUEST_NAME), authorId: null };
    }
    return { author: null, authorId: null };
  }

  // with a store, a room exists only if the store has it (rooms are created from the dashboard);
  // without one (tests), any valid name is a room, made on first use
  async function openRoom(name: string): Promise<Room | null> {
    const doc = new Y.Doc();
    let sinceSnapshot = 0;
    if (store) {
      const saved = await store.load(name);
      if (!saved) return null;
      Y.applyUpdate(doc, saved.state);
      sinceSnapshot = saved.replayed;
    } else {
      Y.applyUpdate(doc, newRoomDocument());
    }

    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null); // the server itself has no presence
    const room: Room = {
      doc,
      awareness,
      conns: new Set(),
      presenceOf: new Map(),
      memberOf: new Map(),
      unsaved: [],
      saving: Promise.resolve(),
      sinceSnapshot,
      dropped: false,
    };

    // forward every change to everyone in the room except the connection it came from, and save it
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      broadcast(
        room,
        syncMessage((e) => syncProtocol.writeUpdate(e, update)),
        origin,
      );
      queueSave(name, room, { update, ...authorOf(room, origin) });
    });

    awareness.on("update", ({ added, updated, removed }: AwarenessChanges, origin: unknown) => {
      // remember which presence entries each connection owns, to clean them up if it drops
      const owned = room.presenceOf.get(origin as WebSocket);
      if (owned) {
        for (const clientId of added) owned.add(clientId);
        for (const clientId of removed) owned.delete(clientId);
      }
      broadcast(room, awarenessMessage(awareness, [...added, ...updated, ...removed]), origin);
    });

    rooms.set(name, room);
    note(`room "${name}" ${store ? "loaded" : "created"} (${rooms.size} rooms)`);
    return room;
  }

  // the room in memory, else from the store. Attempts on one room
  // run one after another, so a guest and a member arriving at once can't race each other
  function getRoom(name: string): Promise<Room | null> {
    const inMemory = rooms.get(name);
    if (inMemory) return Promise.resolve(inMemory);
    const attempt = (opening.get(name) ?? Promise.resolve())
      .catch(() => {}) // a failed earlier attempt doesn't stop this one
      .then(() => rooms.get(name) ?? openRoom(name));
    opening.set(name, attempt);
    const forget = () => {
      if (opening.get(name) === attempt) opening.delete(name);
    };
    attempt.then(forget, forget);
    return attempt;
  }

  // puts a connection in its room, and returns what to do with each message it sends
  function enter(
    socket: WebSocket,
    name: string,
    room: Room,
    member: Member | null,
    say: (text: string) => void,
  ) {
    const { doc, awareness, conns, presenceOf, memberOf } = room;
    if (member) memberOf.set(socket, member);
    clearTimeout(room.unloadTimer);
    room.unloadTimer = undefined;
    conns.add(socket);
    presenceOf.set(socket, new Set());
    say(
      `joined "${name}" as ${member ? `member ${member.id}` : "a guest"} (${conns.size} in room)`,
    );

    // start the handshake: tell the client what the server already has
    socket.send(syncMessage((e) => syncProtocol.writeSyncStep1(e, doc)));

    // and who is already here (clients don't ask for it)
    const present = [...awareness.getStates().keys()];
    if (present.length > 0) socket.send(awarenessMessage(awareness, present));

    // no answer to the last ping means the other end is gone, e.g. a laptop that went to sleep
    let answered = true;
    socket.on("pong", () => {
      answered = true;
    });
    beats.set(socket, () => {
      if (!answered) {
        say("no heartbeat reply, disconnecting");
        socket.terminate(); // the close handler removes its presence
        return;
      }
      if (socket.readyState !== WebSocket.OPEN) return;
      answered = false;
      socket.ping();
      socket.send(KEEPALIVE);
    });

    socket.on("close", (code) => {
      conns.delete(socket);
      beats.delete(socket);
      say(`left "${name}", code ${code} (${conns.size} in room)`);

      // a dropped connection never says goodbye, so remove its presence for everyone else
      memberOf.delete(socket);
      const owned = presenceOf.get(socket);
      presenceOf.delete(socket);
      if (owned && owned.size > 0) {
        awarenessProtocol.removeAwarenessStates(awareness, [...owned], null);
      }
      // without a store, an unloaded room would be lost, so it stays
      if (conns.size === 0 && store) {
        room.unloadTimer = setTimeout(() => unload(name, room), unloadAfterMs);
      }
    });

    return (data: ArrayBuffer) => {
      // a thrown error here would be uncaught and crash the whole server, so contain it
      try {
        const decoder = decoding.createDecoder(new Uint8Array(data));
        switch (decoding.readVarUint(decoder)) {
          case MESSAGE_SYNC: {
            const reply = encoding.createEncoder();
            encoding.writeVarUint(reply, MESSAGE_SYNC);
            syncProtocol.readSyncMessage(decoder, reply, doc, socket);
            if (encoding.length(reply) > 1) socket.send(encoding.toUint8Array(reply));
            break;
          }
          case MESSAGE_AWARENESS:
            awarenessProtocol.applyAwarenessUpdate(
              awareness,
              decoding.readVarUint8Array(decoder),
              socket,
            );
            break;
        }
      } catch (err) {
        say(`malformed message, disconnecting: ${(err as Error).message}`);
        socket.close(CLOSE_MALFORMED, "malformed message");
      }
    };
  }

  wss.on("connection", (socket, req) => {
    const id = nextId++;
    const say = (text: string) => log(`${new Date().toISOString()} [client ${id}] ${text}`);
    socket.binaryType = "arraybuffer";
    socket.on("error", (err) => {
      say(`error: ${err.message}`);
    });

    // ws://host:8080/room-abc  ->  "room-abc"
    const name = new URL(req.url ?? "/", "http://localhost").pathname.slice(1);
    if (!ROOM_NAME.test(name)) {
      say(`rejected, bad room name`);
      socket.close(CLOSE_INVALID_ROOM, "invalid room name");
      return;
    }

    // messages can arrive while the room loads: hold them, in order, until it's ready
    const early: ArrayBuffer[] = [];
    let receive = (data: ArrayBuffer) => {
      early.push(data);
    };
    socket.on("message", (data) => receive(data as ArrayBuffer));

    void (async () => {
      try {
        const admission = admit
          ? await admit(req, name)
          : ({ member: null, role: "editor" } as const);
        if ("refused" in admission) {
          say(`refused: ${admission.refused} for "${name}"`);
          const code = admission.refused === "no-room" ? CLOSE_NO_ROOM : CLOSE_NO_ACCESS;
          socket.close(code, admission.refused === "no-room" ? "room not found" : "no access");
          return;
        }
        const { member } = admission;
        const room = await getRoom(name);
        if (socket.readyState !== WebSocket.OPEN) return; // left while the room was opening
        if (!room || room.dropped) {
          say(`refused: "${name}" doesn't exist`);
          socket.close(CLOSE_NO_ROOM, "room not found");
          return;
        }
        receive = enter(socket, name, room, member, say);
        for (const data of early) receive(data);
      } catch (err) {
        say(`couldn't open "${name}", turning away: ${(err as Error).message}`);
        socket.close(CLOSE_TRY_AGAIN, "room unavailable, try again");
      }
    })();
  });

  return new Promise((resolve) => {
    const ready = () => {
      const address = wss.address();
      resolve({
        port: address !== null && typeof address === "object" ? address.port : (port ?? 0),
        roomCount: () => rooms.size,
        dropRoom: async (name) => {
          await opening.get(name)?.catch(() => {}); // a load in progress puts the room in memory
          const room = rooms.get(name);
          if (!room) return;
          room.dropped = true;
          rooms.delete(name);
          clearTimeout(room.saveTimer);
          clearTimeout(room.unloadTimer);
          room.unsaved = [];
          for (const conn of room.conns) conn.close(CLOSE_DELETED, "room deleted");
          await room.saving; // a write already in flight finishes before the caller goes on
          note(`room "${name}" deleted (${rooms.size} rooms)`);
        },
        close: async () => {
          clearInterval(heartbeat);
          for (const room of rooms.values()) clearTimeout(room.unloadTimer);
          for (const client of wss.clients) client.terminate();
          await new Promise<void>((done) => wss.close(() => done()));
          // nothing new can arrive now: write whatever is still waiting
          await Promise.all([...rooms].map(([name, room]) => flush(name, room)));
        },
      });
    };
    if (server?.listening) ready();
    else wss.on("listening", ready);
  });
}
