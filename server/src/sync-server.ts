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

interface Options {
  port: number; // 0 = let the OS pick a free port (used by tests)
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

export function createSyncServer({ port, log = () => {} }: Options): Promise<SyncServer> {
  const wss = new WebSocketServer({ port });
  const rooms = new Map<string, Room>();
  let nextId = 1;

  function broadcast(room: Room, message: Uint8Array, except: unknown) {
    for (const conn of room.conns) {
      if (conn !== except && conn.readyState === WebSocket.OPEN) conn.send(message);
    }
  }

  function openRoom(name: string): Room {
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null); // the server itself has no presence
    const room: Room = { doc, awareness, conns: new Set(), presenceOf: new Map() };

    // the server creates the first file: if clients did, two joining at once would race
    const file = new Y.Map<unknown>();
    file.set("name", "main.js");
    file.set("content", new Y.Text());
    doc.getMap("files").set(crypto.randomUUID(), file);

    // forward every change to everyone in the room except the connection it came from
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      broadcast(
        room,
        syncMessage((e) => syncProtocol.writeUpdate(e, update)),
        origin,
      );
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
    return room;
  }

  wss.on("connection", (socket, req) => {
    const id = nextId++;
    const say = (text: string) => log(`${new Date().toISOString()} [client ${id}] ${text}`);
    socket.binaryType = "arraybuffer";

    // ws://host:8080/room-abc  ->  "room-abc"
    const name = new URL(req.url ?? "/", "http://localhost").pathname.slice(1);
    if (!ROOM_NAME.test(name)) {
      say(`rejected, bad room name`);
      socket.close(CLOSE_INVALID_ROOM, "invalid room name");
      return;
    }

    let room = rooms.get(name);
    if (!room) {
      room = openRoom(name);
      say(`room "${name}" created (${rooms.size} rooms)`);
    }
    const { doc, awareness, conns, presenceOf } = room;
    conns.add(socket);
    presenceOf.set(socket, new Set());
    say(`joined "${name}" (${conns.size} in room)`);

    // start the handshake: tell the client what the server already has
    socket.send(syncMessage((e) => syncProtocol.writeSyncStep1(e, doc)));

    // and who is already here (clients don't ask for it)
    const present = [...awareness.getStates().keys()];
    if (present.length > 0) socket.send(awarenessMessage(awareness, present));

    socket.on("message", (data) => {
      // a thrown error here would be uncaught and crash the whole server, so contain it
      try {
        const decoder = decoding.createDecoder(new Uint8Array(data as ArrayBuffer));
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
    });

    socket.on("close", (code) => {
      conns.delete(socket);
      say(`left "${name}", code ${code} (${conns.size} in room)`);

      // a dropped connection never says goodbye, so remove its presence for everyone else
      const owned = presenceOf.get(socket);
      presenceOf.delete(socket);
      if (owned && owned.size > 0) {
        awarenessProtocol.removeAwarenessStates(awareness, [...owned], null);
      }
      // empty rooms stay loaded: dropping the doc before it can be saved (M3) loses the file ids
    });

    socket.on("error", (err) => {
      say(`error: ${err.message}`);
    });
  });

  return new Promise((resolve) => {
    wss.on("listening", () => {
      const address = wss.address();
      resolve({
        port: address !== null && typeof address === "object" ? address.port : port,
        roomCount: () => rooms.size,
        close: () =>
          new Promise<void>((done) => {
            for (const client of wss.clients) client.terminate();
            wss.close(() => done());
          }),
      });
    });
  });
}
