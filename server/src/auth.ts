import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { connect } from "./db";
import { accounts, sessions, users, verifications } from "./schema";

// our app as registered at GitHub (Settings > Developer settings > OAuth Apps)
export interface GitHubApp {
  clientId: string; // public: it's in the link to GitHub
  clientSecret: string; // server only, from .env; never committed
}

interface Options {
  databaseUrl: string;
  webOrigin: string; // where the web app runs; the browser reaches /api through it
  github?: GitHubApp; // "Sign in with GitHub", when set up
}

// accounts and sessions (Better Auth), stored in our Postgres
export function createAuth({ databaseUrl, webOrigin, github }: Options) {
  const { db, pool } = connect(databaseUrl);
  const auth = betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      usePlural: true,
      schema: { users, sessions, accounts, verifications },
    }),
    baseURL: webOrigin, // also the one origin trusted to send requests with a session cookie
    // Better Auth skips its origin (CSRF) checks when NODE_ENV=test; tests must run what production runs
    advanced: { disableOriginCheck: false },
    // verifying emails and resetting passwords need an email provider, chosen at deploy (M11)
    emailAndPassword: { enabled: true },
    // GitHub sends people back to <webOrigin>/api/auth/callback/github, which must be registered
    socialProviders: github ? { github } : {},
  });
  return { auth, close: () => pool.end() };
}

export type Auth = ReturnType<typeof createAuth>["auth"];
