import { migrateDatabase } from "./db";
import { openRoomStore } from "./room-store";
import { createSyncServer } from "./sync-server";

const PORT = Number(process.env.PORT ?? 8080);

await migrateDatabase();
const store = openRoomStore();
const server = await createSyncServer({ port: PORT, store, log: console.log });
console.log(`WebSocket server listening on ws://localhost:${PORT}`);

// Ctrl+C, or a hosting platform stopping us: finish saving before exiting
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await server.close();
    await store.close();
    process.exit(0);
  });
}
