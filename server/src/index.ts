import { startApp } from "./app";
import { ConfigProblem, checkConfig } from "./config";
import { migrateDatabase } from "./db";

let config: ReturnType<typeof checkConfig>;
try {
  config = checkConfig(process.env);
} catch (error) {
  if (!(error instanceof ConfigProblem)) throw error;
  console.error(error.message); // what to set, before anything half-starts
  process.exit(1);
}

await migrateDatabase(config.databaseUrl);
const app = await startApp({ ...config, log: console.log });
console.log(`Listening on port ${app.port}: accounts API at /api/auth, rooms over WebSockets`);
if (config.webDir) console.log(`Serving the web app from ${config.webDir}`);
if (!config.github)
  console.log("GitHub sign-in is off: set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET");

// Ctrl+C, or a hosting platform stopping us: finish saving before exiting
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
