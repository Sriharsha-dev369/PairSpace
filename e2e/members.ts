// Helpers for signed-in browsers, and the guests they invite. Only members create rooms; people
// they invite join as guests.

import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";

export const PASSWORD = "correct horse battery";
export const newEmail = () => `${crypto.randomUUID()}@example.com`;

// signs a browser up the quick way, straight through the accounts API (the pages have own tests)
async function signUp(context: BrowserContext, name = "Room Owner") {
  const origin = test.info().project.use.baseURL ?? ""; // as the browser would send it
  const response = await context.request.post("/api/auth/sign-up/email", {
    headers: { origin },
    data: { name, email: newEmail(), password: PASSWORD },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

// a separate browser (its own cookies), already signed up as a member
export async function memberBrowser(browser: Browser, options = {}, name?: string) {
  const context = await browser.newContext(options);
  await signUp(context, name);
  return context;
}

// a room created on the member's dashboard (the only way rooms are made), by its API
export async function createRoom(context: BrowserContext, title?: string): Promise<string> {
  const origin = test.info().project.use.baseURL ?? "";
  const response = await context.request.post("/api/rooms", {
    headers: { origin },
    data: title === undefined ? {} : { title },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).id;
}

// the room's share link (edit, unless asked for view-only), as its owner gets it from Share
export async function shareLink(
  context: BrowserContext,
  roomId: string,
  role: "editor" | "viewer" = "editor",
): Promise<string> {
  const origin = test.info().project.use.baseURL ?? "";
  const response = await context.request.post(`/api/rooms/${roomId}/links`, {
    headers: { origin },
    data: { role },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return `/join/${(await response.json()).code}`;
}

// a room a member created on their dashboard, and its share link: the invite
export async function newRoomUrl(browser: Browser): Promise<string> {
  const owner = await memberBrowser(browser);
  const url = await shareLink(owner, await createRoom(owner));
  await owner.close();
  return url;
}

// each person gets their own browser context: separate storage, like two different computers.
// Invited people join as guests (no account)
export async function openRoomAs(browser: Browser, url: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(url);
  await expect(page.locator(".cm-content")).toBeVisible();
  return page;
}

// two guests in a new room, each in their own browser
export async function twoGuestsIn(browser: Browser): Promise<[Page, Page]> {
  const url = await newRoomUrl(browser);
  return [await openRoomAs(browser, url), await openRoomAs(browser, url)];
}
