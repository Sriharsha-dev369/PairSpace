import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

// the Postgres from docker-compose.yml (npm run db:up); deployments set DATABASE_URL
export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://pairspace:pairspace@localhost:5433/pairspace";

// the SQL files drizzle-kit generates from schema.ts, applied in order
const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));

export function connect(url = DATABASE_URL) {
  const pool = new pg.Pool({ connectionString: url });
  return { db: drizzle(pool), pool };
}

export type Database = ReturnType<typeof connect>["db"];

export async function migrateDatabase(url = DATABASE_URL) {
  const { db, pool } = connect(url);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS });
  } finally {
    await pool.end();
  }
}
