// Vitest global setup: before any test, make sure the test database exists and has the latest
// schema. Tests use their own database so they never touch development data.

import pg from "pg";
import { DATABASE_URL, migrateDatabase } from "../src/db";

const url = new URL(DATABASE_URL);
url.pathname = "/pairspace_test";
export const TEST_DATABASE_URL = url.toString();

export default async function setup() {
  const admin = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(`Postgres isn't reachable (start it with: npm run db:up). ${err}`);
  }
  const { rowCount } = await admin.query(
    "SELECT 1 FROM pg_database WHERE datname = 'pairspace_test'",
  );
  if (rowCount === 0) await admin.query("CREATE DATABASE pairspace_test");
  await admin.end();
  await migrateDatabase(TEST_DATABASE_URL);
}
