import { createSyncServer } from "./sync-server";

const PORT = Number(process.env.PORT ?? 8080);
await createSyncServer({ port: PORT, log: console.log });
console.log(`WebSocket server listening on ws://localhost:${PORT}`);
