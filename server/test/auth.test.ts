// Spec for accounts: signing up, in and out through the server's HTTP API (Better Auth).
// Runs the real app against the test database; every test uses a fresh email.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type App, startApp } from "../src/app";
import { TEST_DATABASE_URL } from "./database";

const WEB_ORIGIN = "http://localhost:5173";
const PASSWORD = "correct horse battery";

let app: App;
beforeAll(async () => {
  app = await startApp({ port: 0, databaseUrl: TEST_DATABASE_URL, webOrigin: WEB_ORIGIN });
});
afterAll(() => app.close());

const newEmail = () => `person-${crypto.randomUUID()}@example.com`;

// a request as the web app makes it: JSON, from its origin, with the session cookie if it has one
function call(path: string, { body, cookie }: { body?: object; cookie?: string } = {}) {
  return fetch(`http://localhost:${app.port}/api/auth${path}`, {
    method: body ? "POST" : "GET",
    headers: { origin: WEB_ORIGIN, "content-type": "application/json", ...(cookie && { cookie }) },
    body: body && JSON.stringify(body),
  });
}

// the cookies the server set, as the browser would send them back
const cookiesFrom = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

// whose session a cookie belongs to, by email; null if it isn't a working session
async function signedInAs(cookie: string): Promise<string | null> {
  const session = await (await call("/get-session", { cookie })).json();
  return session?.user?.email ?? null;
}

const signUp = (email: string, name = "Alice", password = PASSWORD) =>
  call("/sign-up/email", { body: { name, email, password } });

describe("accounts", () => {
  it("signs up with an email and password, and is signed in", async () => {
    const email = newEmail();

    const response = await signUp(email);

    expect(response.status).toBe(200);
    expect(await signedInAs(cookiesFrom(response))).toBe(email);
  });

  it("refuses a second account with the same email", async () => {
    const email = newEmail();
    await signUp(email);

    const again = await signUp(email, "Mallory", "another password");

    expect(again.ok).toBe(false);
    expect(cookiesFrom(again)).toBe("");
  });

  it("signs in with the right password", async () => {
    const email = newEmail();
    await signUp(email);

    const response = await call("/sign-in/email", { body: { email, password: PASSWORD } });

    expect(response.status).toBe(200);
    expect(await signedInAs(cookiesFrom(response))).toBe(email);
  });

  it("refuses a wrong password", async () => {
    const email = newEmail();
    await signUp(email);

    const response = await call("/sign-in/email", { body: { email, password: "wrong password" } });

    expect(response.status).toBe(401);
    expect(cookiesFrom(response)).toBe("");
  });

  it("signs out, after which the session no longer works", async () => {
    const cookie = cookiesFrom(await signUp(newEmail()));

    const response = await call("/sign-out", { body: {}, cookie });

    expect(response.status).toBe(200);
    expect(await signedInAs(cookie)).toBeNull();
  });

  // another website can make the browser send our cookie; the request's origin gives it away
  it("refuses a request from another website, even with a valid session cookie", async () => {
    const email = newEmail();
    const cookie = cookiesFrom(await signUp(email));

    const forged = await fetch(`http://localhost:${app.port}/api/auth/sign-out`, {
      method: "POST",
      headers: { origin: "http://evil.example", "content-type": "application/json", cookie },
      body: "{}",
    });

    expect(forged.status).toBe(403);
    expect(await signedInAs(cookie)).toBe(email);
  });
});

describe("signing in with GitHub", () => {
  const GITHUB = { clientId: "test-github-app", clientSecret: "test-github-secret" };
  let withGitHub: App;
  beforeAll(async () => {
    withGitHub = await startApp({
      port: 0,
      databaseUrl: TEST_DATABASE_URL,
      webOrigin: WEB_ORIGIN,
      github: GITHUB,
    });
  });
  afterAll(() => withGitHub.close());

  const methods = async (server: App) =>
    (await fetch(`http://localhost:${server.port}/api/sign-in-methods`)).json();

  it("offers GitHub sign-in only when it's set up", async () => {
    expect(await methods(app)).toEqual({ github: false });
    expect(await methods(withGitHub)).toEqual({ github: true });
  });

  it("sends people to GitHub with our app's id, and asks GitHub to send them back to us", async () => {
    const response = await fetch(`http://localhost:${withGitHub.port}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ provider: "github", callbackURL: "/r/abc123" }),
    });

    const goTo = new URL((await response.json()).url);
    expect(goTo.origin + goTo.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(goTo.searchParams.get("client_id")).toBe(GITHUB.clientId);
    expect(goTo.searchParams.get("redirect_uri")).toBe(`${WEB_ORIGIN}/api/auth/callback/github`);
    expect(goTo.searchParams.get("state")).toBeTruthy(); // checked on the way back
  });
});
