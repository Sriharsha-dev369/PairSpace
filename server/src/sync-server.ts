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
}

interface AwarenessChanges {
  added: number[];
  updated: number[];
  removed: number[];
}

// message types of the y-websocket protocol
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

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
    const room: Room = { doc, awareness, conns: new Set() };

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
      socket.close(1008, "invalid room name");
      return;
    }

    let room = rooms.get(name);
    if (!room) {
      room = openRoom(name);
      say(`room "${name}" created (${rooms.size} rooms)`);
    }
    const { doc, awareness, conns } = room;
    conns.add(socket);
    say(`joined "${name}" (${conns.size} in room)`);

    // start the handshake: tell the client what the server already has
    socket.send(syncMessage((e) => syncProtocol.writeSyncStep1(e, doc)));

    // and who is already here (clients don't ask for it)
    const present = [...awareness.getStates().keys()];
    if (present.length > 0) socket.send(awarenessMessage(awareness, present));

    socket.on("message", (data) => {
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
    });

    socket.on("close", (code) => {
      conns.delete(socket);
      say(`left "${name}", code ${code} (${conns.size} in room)`);

      // an empty room is never used again unless someone rejoins, so don't keep it
      if (conns.size === 0) {
        awareness.destroy();
        doc.destroy();
        rooms.delete(name);
        say(`room "${name}" removed (${rooms.size} rooms)`);
      }
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
