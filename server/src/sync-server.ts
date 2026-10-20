import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { WebSocket, WebSocketServer } from "ws";
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
  conns: Set<WebSocket>;
}

// message types of the y-websocket protocol
const MESSAGE_SYNC = 0;

// the room name comes from the URL, which the client controls, so restrict it
const ROOM_NAME = /^[A-Za-z0-9_-]{1,64}$/;

function syncMessage(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

export function createSyncServer({ port, log = () => {} }: Options): Promise<SyncServer> {
  const wss = new WebSocketServer({ port });
  const rooms = new Map<string, Room>();
  let nextId = 1;

  function openRoom(name: string): Room {
    const doc = new Y.Doc();
    const room: Room = { doc, conns: new Set() };

    // the server creates the first file: if clients did, two joining at once would race
    const file = new Y.Map<unknown>();
    file.set("name", "main.js");
    file.set("content", new Y.Text());
    doc.getMap("files").set(crypto.randomUUID(), file);

    // forward every change to everyone in the room except the connection it came from
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      const message = syncMessage((e) => syncProtocol.writeUpdate(e, update));
      for (const conn of room.conns) {
        if (conn !== origin && conn.readyState === WebSocket.OPEN) conn.send(message);
      }
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
    const { doc, conns } = room;
    conns.add(socket);
    say(`joined "${name}" (${conns.size} in room)`);

    // start the handshake: tell the client what the server already has
    socket.send(syncMessage((e) => syncProtocol.writeSyncStep1(e, doc)));

    socket.on("message", (data) => {
      const decoder = decoding.createDecoder(new Uint8Array(data as ArrayBuffer));
      if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;

      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, reply, doc, socket);
      if (encoding.length(reply) > 1) socket.send(encoding.toUint8Array(reply));
    });

    socket.on("close", (code) => {
      conns.delete(socket);
      say(`left "${name}", code ${code} (${conns.size} in room)`);

      // an empty room is never used again unless someone rejoins, so don't keep it
      if (conns.size === 0) {
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
