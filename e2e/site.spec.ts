// End-to-end spec for what every page shares: titles, dead ends, crashes, link previews.

import { expect, test } from "@playwright/test";
import { createRoom, memberBrowser, shareLink } from "./members";

test("an unknown address says there's nothing there, with a way home", async ({ page }) => {
  await page.goto("/no-such-page");

  await expect(page.getByRole("heading", { name: "There's nothing here" })).toBeVisible();
  await expect(page).toHaveTitle("Page not found – PairSpace");
  await page.getByRole("link", { name: "Go to the home page" }).click();
  await expect(page).toHaveURL("/");
});

// e.g. after a new version is deployed, the old page's code files are gone
test("a page whose code fails to load says so, and Reload brings it back", async ({ browser }) => {
  const owner = await memberBrowser(browser);
  const roomId = await createRoom(owner, "Interview prep");
  const page = await owner.newPage();
  await page.route("**/ReplayPage*", (route) => route.abort()); // its code, however it's served

  await page.goto(`/r/${roomId}/replay`);
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();

  await page.unroute("**/ReplayPage*");
  await page.getByRole("button", { name: "Reload" }).click();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
});

// the not-found page fetches no other page's code ahead, so going home from it needs the network
test("a page that can't be downloaded because you're offline says that", async ({ page }) => {
  await page.goto("/no-such-page");
  await page.waitForLoadState("networkidle");
  await page.context().setOffline(true);

  await page.getByRole("link", { name: "Go to the home page" }).click();

  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
  await expect(page.getByText("You're offline")).toBeVisible();
});

test("each page has its own title, so tabs and history tell them apart", async ({ browser }) => {
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto("/");
  await expect(visitor).toHaveTitle("PairSpace – code together in real time");
  await visitor.goto("/sign-in");
  await expect(visitor).toHaveTitle("Sign in – PairSpace");
  await visitor.goto("/sign-up");
  await expect(visitor).toHaveTitle("Create your account – PairSpace");

  const owner = await memberBrowser(browser);
  const roomId = await createRoom(owner, "Interview prep");
  const page = await owner.newPage();
  await page.goto("/");
  await expect(page).toHaveTitle("Your rooms – PairSpace");
  await page.goto(`/r/${roomId}`);
  await expect(page).toHaveTitle("Interview prep – PairSpace");
  await page.goto(`/r/${roomId}/replay`);
  await expect(page).toHaveTitle("Replay of Interview prep – PairSpace");
});

test("a link pasted into a chat shows PairSpace's preview card", async ({ page }) => {
  await page.goto("/");
  const meta = (property: string) =>
    page.locator(`meta[property="${property}"], meta[name="${property}"]`).getAttribute("content");

  expect(await meta("og:title")).toBe("PairSpace");
  expect(await meta("og:description")).toMatch(/real time/);
  expect(await meta("twitter:card")).toBe("summary_large_image");
  const image = await meta("og:image");
  expect(image).toMatch(/^https?:\/\/.+\/og\.png$/); // chat apps need the full address

  const response = await page.request.get("/og.png");
  expect(response.headers()["content-type"]).toBe("image/png");
});

// ---------- when PairSpace can't be reached ----------

test("joining a room that takes too long says so, and keeps trying", async ({ browser }) => {
  const owner = await memberBrowser(browser);
  const roomId = await createRoom(owner);
  const page = await owner.newPage();
  // the room server takes the connection and never answers (Vite's own socket is another port)
  await page.routeWebSocket(/localhost:8790/, () => {});

  await page.goto(`/r/${roomId}`);

  await expect(page.getByText("Joining room")).toBeVisible();
  await expect(page.getByText("Taking longer than usual")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
});

test("an invite that can't be checked right now says so, and Try again opens it", async ({
  browser,
}) => {
  const owner = await memberBrowser(browser);
  const link = await shareLink(owner, await createRoom(owner, "Interview prep"));
  const guest = await (await browser.newContext()).newPage();
  await guest.route("**/api/links/*", (route) => route.abort());

  await guest.goto(link);

  await expect(guest.getByRole("heading", { name: "Couldn't check this invite" })).toBeVisible();
  await guest.unroute("**/api/links/*");
  await guest.getByRole("button", { name: "Try again" }).click();
  await expect(guest.getByRole("button", { name: "Join room" })).toBeVisible();
});

test("a replay whose history can't load right now says so, and Try again loads it", async ({
  browser,
}) => {
  const owner = await memberBrowser(browser);
  const roomId = await createRoom(owner, "Interview prep");
  const page = await owner.newPage();
  await page.route("**/history*", (route) => route.abort());

  await page.goto(`/r/${roomId}/replay`);

  await expect(
    page.getByRole("heading", { name: "Couldn't load this room's history" }),
  ).toBeVisible();
  await page.unroute("**/history*");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
});
