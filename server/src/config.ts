// The server's settings, from its environment, checked once at start. In development everything
// has a default; a deployment must say where its database and site are, and keep a secret.

import { z } from "zod";
import type { GitHubApp } from "./auth";

export interface Config {
  port: number;
  databaseUrl?: string; // unset in development: db.ts's local Docker database
  webOrigin: string; // the site's own address: cookies and requests are trusted only from it
  webDir?: string; // the built web app to serve (production); unset, Vite serves it
  github?: GitHubApp;
  sentryDsn?: string; // where to report errors (Sentry); unset, they're only logged
}

const required = (name: string, what: string) => ({ error: `${name}: ${what}` });

// what a deployment must set: refused all together, so one deploy shows every problem
const PRODUCTION = z.object({
  DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    ...required("DATABASE_URL", "the database's postgres:// address (Neon's connection string)"),
  }),
  WEB_ORIGIN: z.url({
    protocol: /^https$/,
    ...required(
      "WEB_ORIGIN",
      "the site's own https:// address, e.g. https://pairspace.onrender.com",
    ),
  }),
  BETTER_AUTH_SECRET: z
    .string(required("BETTER_AUTH_SECRET", "a random secret (openssl rand -base64 32)"))
    .min(32, "BETTER_AUTH_SECRET: at least 32 characters (openssl rand -base64 32)"),
});

export class ConfigProblem extends Error {}

export function checkConfig(given: Record<string, string | undefined>): Config {
  // on Render, the service's own address stands in for WEB_ORIGIN (a custom domain sets it)
  const env: Record<string, string | undefined> = {
    ...given,
    WEB_ORIGIN: given.WEB_ORIGIN ?? given.RENDER_EXTERNAL_URL,
  };
  if (env.NODE_ENV === "production") {
    const checked = PRODUCTION.safeParse(env);
    if (!checked.success) {
      const problems = checked.error.issues.map((issue) => `  - ${issue.message}`);
      throw new ConfigProblem(`PairSpace can't start. Set these:\n${problems.join("\n")}`);
    }
  }
  const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } = env;
  return {
    port: Number(env.PORT ?? 8080),
    databaseUrl: env.DATABASE_URL,
    webOrigin: env.WEB_ORIGIN ?? "http://localhost:5173", // Vite, in development
    webDir: env.WEB_DIR,
    github:
      GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET
        ? { clientId: GITHUB_CLIENT_ID, clientSecret: GITHUB_CLIENT_SECRET }
        : undefined,
    sentryDsn: env.SENTRY_DSN,
  };
}
