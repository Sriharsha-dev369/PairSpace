import { defineConfig } from "drizzle-kit";

// npm run db:generate -w server turns schema changes into a new SQL migration in drizzle/
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
});
