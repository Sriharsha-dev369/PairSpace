import { createRelayServer } from "./relay";

const PORT = Number(process.env.PORT ?? 8080);
await createRelayServer({ port: PORT, log: console.log });
console.log(`WebSocket server listening on ws://localhost:${PORT}`);
