// Spec for running in production: the server serves the built web app from its own origin, says
// whether it's healthy, refuses to start without its settings, and sends security headers.

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type App, startApp } from "../src/app";
import { checkConfig } from "../src/config";
import { WEB_ORIGIN } from "./browser";
import { TEST_DATABASE_URL } from "./database";

const YEAR = "public, max-age=31536000, immutable";

let app: App;
const get = (path: string, server = app) => fetch(`http://localhost:${server.port}${path}`);

// a stand-in for web/dist: the page, a hashed bundle, and an unhashed public file
beforeAll(async () => {
  const webDir = await mkdtemp(join(tmpdir(), "pairspace-web-"));
  await mkdir(join(webDir, "assets"));
  await mkdir(join(webDir, "sandbox"));
  await writeFile(join(webDir, "index.html"), "<!doctype html><title>PairSpace</title>");
  await writeFile(join(webDir, "assets", "index-a1B2c3D4.js"), "console.log('the app')");
  await writeFile(join(webDir, "sandbox", "frame.js"), "// the sandbox");
  app = await startApp({ port: 0, databaseUrl: TEST_DATABASE_URL, webOrigin: WEB_ORIGIN, webDir });
});
afterAll(() => app.close());

describe("the built web app", () => {
  it("serves its page for the home page and for every address the app itself handles", async () => {
    for (const path of ["/", "/r/abc123def4", "/join/some-code", "/no-such-page"]) {
      const response = await get(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("content-type"), path).toMatch(/^text\/html/);
      expect(response.headers.get("cache-control"), path).toBe("no-cache"); // a new deploy shows at once
      expect(await response.text(), path).toContain("<title>PairSpace</title>");
    }
  });

  it("serves its files, keeping the ones named by their content for a year", async () => {
    const bundle = await get("/assets/index-a1B2c3D4.js");
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get("content-type")).toMatch(/javascript/);
    expect(bundle.headers.get("cache-control")).toBe(YEAR);
    expect(await bundle.text()).toBe("console.log('the app')");

    const sandbox = await get("/sandbox/frame.js"); // same name in every version
    expect(sandbox.status).toBe(200);
    expect(sandbox.headers.get("cache-control")).toBe("no-cache");
  });

  it("never answers an API address, or a missing file, with the page", async () => {
    expect((await get("/api/nope")).status).toBe(404);
    expect((await get("/assets/gone-0a1b2c3d.js")).status).toBe(404); // an old deploy's bundle
  });

  it("sends security headers, letting only its own pages frame it (Run's sandbox)", async () => {
    const response = await get("/");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("strict-transport-security")).toMatch(/max-age=\d+/);
  });
});

describe("health", () => {
  it("is healthy when the database answers", async () => {
    const response = await get("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("is unhealthy when the database doesn't", async () => {
    const cutOff = await startApp({
      port: 0,
      databaseUrl: "postgres://nobody:nothing@localhost:1/none", // nothing listens on port 1
      webOrigin: WEB_ORIGIN,
    });
    try {
      const response = await get("/api/health", cutOff);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false });
    } finally {
      await cutOff.close();
    }
  });
});

describe("errors", () => {
  // the database is unreachable, so looking up an invite fails inside the server
  it("reports a request that failed, and answers it with a plain 500", async () => {
    const reported: unknown[] = [];
    const broken = await startApp({
      port: 0,
      databaseUrl: "postgres://nobody:nothing@localhost:1/none",
      webOrigin: WEB_ORIGIN,
      report: (error) => reported.push(error),
    });
    try {
      const response = await get("/api/links/some-code", broken);
      expect(response.status).toBe(500);
      expect(await response.text()).toBe("Something went wrong"); // nothing about the insides
      expect(reported).toHaveLength(1);
      expect(reported[0]).toBeInstanceOf(Error);
    } finally {
      await broken.close();
    }
  });
});

describe("settings", () => {
  const PRODUCTION = {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://user:secret@db.example.com/pairspace?sslmode=require",
    WEB_ORIGIN: "https://pairspace.onrender.com",
    BETTER_AUTH_SECRET: "x".repeat(32),
  };

  it("runs in development with nothing set", () => {
    expect(checkConfig({})).toMatchObject({
      port: 8080,
      webOrigin: "http://localhost:5173",
      webDir: undefined,
      github: undefined,
    });
  });

  it("takes a deployment's settings", () => {
    expect(
      checkConfig({
        ...PRODUCTION,
        PORT: "10000",
        WEB_DIR: "../web/dist",
        GITHUB_CLIENT_ID: "id",
        GITHUB_CLIENT_SECRET: "s",
        SENTRY_DSN: "https://key@o1.ingest.sentry.io/2",
      }),
    ).toEqual({
      port: 10000,
      databaseUrl: PRODUCTION.DATABASE_URL,
      webOrigin: PRODUCTION.WEB_ORIGIN,
      webDir: "../web/dist",
      github: { clientId: "id", clientSecret: "s" },
      sentryDsn: "https://key@o1.ingest.sentry.io/2",
    });
  });

  // Render tells a service its own address, so a deploy there needn't be told it again
  it("takes the site's address from Render when WEB_ORIGIN isn't set", () => {
    const { WEB_ORIGIN: _, ...onRender } = PRODUCTION;
    expect(
      checkConfig({ ...onRender, RENDER_EXTERNAL_URL: "https://pairspace.onrender.com" }).webOrigin,
    ).toBe("https://pairspace.onrender.com");
  });

  it("refuses to run in production without its settings, naming every one that's missing", () => {
    expect(() => checkConfig({ NODE_ENV: "production" })).toThrow(
      /DATABASE_URL[\s\S]*WEB_ORIGIN[\s\S]*BETTER_AUTH_SECRET/,
    );
  });

  // a setting that's there but malformed (e.g. Neon's string pasted with "psql '...'") must not
  // read like a missing one, and its value (a password) must not appear in the logs
  it("says whether a setting is missing or set but malformed, without printing it", () => {
    expect(() => checkConfig({ ...PRODUCTION, DATABASE_URL: undefined })).toThrow(
      /DATABASE_URL: missing/,
    );
    expect(() => checkConfig({ ...PRODUCTION, DATABASE_URL: "" })).toThrow(/DATABASE_URL: missing/);
    const wrapped = `psql '${PRODUCTION.DATABASE_URL}'`;
    try {
      checkConfig({ ...PRODUCTION, DATABASE_URL: wrapped });
      expect.unreachable("a psql-wrapped string must be refused");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/DATABASE_URL: set, but not a postgres:\/\/ address/);
      expect(message).not.toContain("secret"); // the password in PRODUCTION's DATABASE_URL
    }
  });

  it("refuses an address that isn't https, and a short secret, in production", () => {
    expect(() =>
      checkConfig({ ...PRODUCTION, WEB_ORIGIN: "http://pairspace.onrender.com" }),
    ).toThrow(/WEB_ORIGIN/);
    expect(() => checkConfig({ ...PRODUCTION, BETTER_AUTH_SECRET: "too short" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });
});
