import * as Sentry from "@sentry/node";
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

// errors reach Sentry when a deployment says where (crashes too, from here on); otherwise logs only
if (config.sentryDsn) {
  Sentry.init({
    dsn: config.sentryDsn,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.RENDER_GIT_COMMIT, // Render sets it: which commit an error came from
  });
}

await migrateDatabase(config.databaseUrl);
const app = await startApp({
  ...config,
  log: console.log,
  report: (error) => Sentry.captureException(error),
});
console.log(`Listening on port ${app.port}: accounts API at /api/auth, rooms over WebSockets`);
if (config.webDir) console.log(`Serving the web app from ${config.webDir}`);
if (!config.github)
  console.log("GitHub sign-in is off: set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET");

// Ctrl+C, or a hosting platform stopping us: finish saving before exiting
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await app.close();
    await Sentry.close(2000); // send what's still queued
    process.exit(0);
  });
}
