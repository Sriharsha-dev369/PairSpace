import { createRelayServer } from "./relay.ts";

const PORT = 8080;
await createRelayServer({ port: PORT, log: console.log });
console.log(`WebSocket server listening on ws://localhost:${PORT}`);
