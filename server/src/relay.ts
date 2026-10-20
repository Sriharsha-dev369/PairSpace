import { WebSocket, WebSocketServer } from "ws";

export interface RelayServer {
  port: number;
  roomCount(): number;
  close(): Promise<void>;
}

interface Options {
  port: number; // 0 = let the OS pick a free port (used by tests)
  log?: (line: string) => void;
}

// the room name comes from the URL, which the client controls, so restrict it
const ROOM_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export function createRelayServer({ port, log = () => {} }: Options): Promise<RelayServer> {
  const wss = new WebSocketServer({ port });

  // room name -> the connections currently in it
  const rooms = new Map<string, Set<WebSocket>>();
  let nextId = 1;

  wss.on("connection", (socket, req) => {
    const id = nextId++;
    const say = (text: string) => log(`${new Date().toISOString()} [client ${id}] ${text}`);

    // ws://host:8080/room-abc  ->  "room-abc"
    const room = new URL(req.url ?? "/", "http://localhost").pathname.slice(1);
    if (!ROOM_NAME.test(room)) {
      say(`rejected, bad room name`);
      socket.close(1008, "invalid room name");
      return;
    }

    let members = rooms.get(room);
    if (!members) {
      members = new Set();
      rooms.set(room, members);
      say(`room "${room}" created (${rooms.size} rooms)`);
    }
    members.add(socket);
    say(`joined "${room}" (${members.size} in room)`);

    socket.on("message", (data) => {
      const text = data.toString();
      say(`[${room}] message: ${text}`);

      // relay to everyone in the same room except the sender
      for (const other of members) {
        if (other !== socket && other.readyState === WebSocket.OPEN) {
          other.send(text);
        }
      }
    });

    socket.on("close", (code) => {
      members.delete(socket);
      say(`left "${room}", code ${code} (${members.size} in room)`);

      // an empty room is never used again unless someone rejoins, so don't keep it
      if (members.size === 0) {
        rooms.delete(room);
        say(`room "${room}" removed (${rooms.size} rooms)`);
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
