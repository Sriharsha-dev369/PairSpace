import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { WebSocket, WebSocketServer } from "ws";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

export interface SyncServer {
  port: number;
  roomCount(): number;
  close(): Promise<void>;
}

export interface StoredChange {
  update: Uint8Array;
  author: string | null; // the display name of who made it; null for the server's own changes
}

// where rooms are saved (Postgres in production); without one, rooms live only in memory
export interface RoomStore {
  load(room: string): Promise<Uint8Array | null>; // every saved change merged; null if never saved
  append(room: string, changes: StoredChange[]): Promise<void>;
}

interface Options {
  port: number; // 0 = let the OS pick a free port (used by tests)
  store?: RoomStore;
  heartbeatMs?: number;
  maxMessageBytes?: number;
  log?: (line: string) => void;
}

interface Room {
  doc: Y.Doc; // the server's copy, so late joiners can sync even when nobody else is online
  awareness: awarenessProtocol.Awareness; // live presence (names, cursors), never saved
  conns: Set<WebSocket>;
  presenceOf: Map<WebSocket, Set<number>>; // the awareness client ids each connection owns
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

// y-websocket clients drop a connection they hear nothing on for 30s, so beat well inside that
const HEARTBEAT_MS = 10_000;
// an awareness message (type, payload length 1) listing zero people: clients apply it as a no-op
const KEEPALIVE = new Uint8Array([MESSAGE_AWARENESS, 1, 0]);

// the biggest legit message is a whole room re-sent after the server lost it; refuse more (1009)
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;

// the room name comes from the URL, which the client controls, so restrict it
const ROOM_NAME = /^[A-Za-z0-9_-]{1,64}$/;

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
  store,
  heartbeatMs = HEARTBEAT_MS,
  maxMessageBytes = MAX_MESSAGE_BYTES,
  log = () => {},
}: Options): Promise<SyncServer> {
  // ws checks a frame's declared length before reading it, so oversize messages are never buffered
  const wss = new WebSocketServer({ port, maxPayload: maxMessageBytes });
  const rooms = new Map<string, Room>();
  const loading = new Map<string, Promise<Room>>(); // rooms being read from the store
  const writes = new Set<Promise<void>>(); // saves in flight, so close() can wait for them
  const beats = new Map<WebSocket, () => void>(); // what each connection does on every heartbeat
  let nextId = 1;

  const heartbeat = setInterval(() => {
    for (const beat of beats.values()) beat();
  }, heartbeatMs);

  function broadcast(room: Room, message: Uint8Array, except: unknown) {
    for (const conn of room.conns) {
      if (conn !== except && conn.readyState === WebSocket.OPEN) conn.send(message);
    }
  }

  function save(name: string, changes: StoredChange[]) {
    if (!store) return;
    const write: Promise<void> = store
      .append(name, changes)
      .catch((err: Error) =>
        log(`${new Date().toISOString()} couldn't save "${name}": ${err.message}`),
      )
      .finally(() => writes.delete(write));
    writes.add(write);
  }

  // who is behind a connection, by the display name in the presence it sent
  function authorOf(room: Room, origin: unknown): string | null {
    for (const clientId of room.presenceOf.get(origin as WebSocket) ?? []) {
      const name = room.awareness.getStates().get(clientId)?.user?.name;
      if (typeof name === "string") return name;
    }
    return null;
  }

  async function openRoom(name: string): Promise<Room> {
    const doc = new Y.Doc();
    const saved = store ? await store.load(name) : null;
    if (saved) {
      Y.applyUpdate(doc, saved);
    } else {
      // the server creates the first file: if clients did, two joining at once would race
      const file = new Y.Map<unknown>();
      file.set("name", "main.js");
      file.set("content", new Y.Text());
      doc.getMap("files").set(crypto.randomUUID(), file);
      // saved before anyone is let in, so a restart can never give the room a second file
      if (store) await store.append(name, [{ update: Y.encodeStateAsUpdate(doc), author: null }]);
    }

    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null); // the server itself has no presence
    const room: Room = { doc, awareness, conns: new Set(), presenceOf: new Map() };

    // forward every change to everyone in the room except the connection it came from, and save it
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      broadcast(
        room,
        syncMessage((e) => syncProtocol.writeUpdate(e, update)),
        origin,
      );
      save(name, [{ update, author: authorOf(room, origin) }]);
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
    log(
      `${new Date().toISOString()} room "${name}" ${saved ? "loaded" : "created"} (${rooms.size} rooms)`,
    );
    return room;
  }

  // the room in memory, or loaded from the store; people joining at once share one load
  function getRoom(name: string): Promise<Room> {
    const room = rooms.get(name);
    if (room) return Promise.resolve(room);
    let load = loading.get(name);
    if (!load) {
      load = openRoom(name).finally(() => loading.delete(name));
      loading.set(name, load);
    }
    return load;
  }

  // puts a connection in its room, and returns what to do with each message it sends
  function admit(socket: WebSocket, name: string, room: Room, say: (text: string) => void) {
    const { doc, awareness, conns, presenceOf } = room;
    conns.add(socket);
    presenceOf.set(socket, new Set());
    say(`joined "${name}" (${conns.size} in room)`);

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
      const owned = presenceOf.get(socket);
      presenceOf.delete(socket);
      if (owned && owned.size > 0) {
        awarenessProtocol.removeAwarenessStates(awareness, [...owned], null);
      }
      // empty rooms stay loaded: dropping the doc before it can be saved (M3) loses the file ids
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

    getRoom(name).then(
      (room) => {
        if (socket.readyState !== WebSocket.OPEN) return; // left while the room was loading
        receive = admit(socket, name, room, say);
        for (const data of early) receive(data);
      },
      (err: Error) => {
        say(`couldn't load "${name}", turning away: ${err.message}`);
        socket.close(CLOSE_TRY_AGAIN, "room unavailable, try again");
      },
    );
  });

  return new Promise((resolve) => {
    wss.on("listening", () => {
      const address = wss.address();
      resolve({
        port: address !== null && typeof address === "object" ? address.port : port,
        roomCount: () => rooms.size,
        close: async () => {
          clearInterval(heartbeat);
          for (const client of wss.clients) client.terminate();
          await new Promise<void>((done) => wss.close(() => done()));
          await Promise.all([...writes]); // nothing new can arrive now; finish saving what did
        },
      });
    });
  });
}
