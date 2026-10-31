import { startApp } from "./app";
import { migrateDatabase } from "./db";

const PORT = Number(process.env.PORT ?? 8080);
const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } = process.env;
const github =
  GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET
    ? { clientId: GITHUB_CLIENT_ID, clientSecret: GITHUB_CLIENT_SECRET }
    : undefined;

await migrateDatabase();
const app = await startApp({ port: PORT, github, log: console.log });
console.log(`Listening on port ${app.port}: accounts API at /api/auth, rooms over WebSockets`);
if (!github) console.log("GitHub sign-in is off: set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET");

// Ctrl+C, or a hosting platform stopping us: finish saving before exiting
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
