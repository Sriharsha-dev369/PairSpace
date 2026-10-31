import { startApp } from "./app";
import { migrateDatabase } from "./db";

const PORT = Number(process.env.PORT ?? 8080);

await migrateDatabase();
const app = await startApp({ port: PORT, log: console.log });
console.log(`Listening on port ${app.port}: accounts API at /api/auth, rooms over WebSockets`);

// Ctrl+C, or a hosting platform stopping us: finish saving before exiting
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
