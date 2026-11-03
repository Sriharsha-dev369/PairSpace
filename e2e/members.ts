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
// Invited people join as guests (no account), keeping the name the invite screen suggests
export async function openRoomAs(browser: Browser, url: string, options = {}): Promise<Page> {
  const page = await (await browser.newContext(options)).newPage();
  await page.goto(url);
  await joinAsSuggested(page);
  return page;
}

// a new guest meets the name screen first: join under the name it suggests
export async function joinAsSuggested(page: Page) {
  const join = page.getByRole("button", { name: "Join room" });
  const editor = page.locator(".cm-content");
  await expect(join.or(editor)).toBeVisible();
  if (await join.isVisible()) await join.click();
  await expect(editor).toBeVisible();
}

// two guests in a new room, each in their own browser
export async function twoGuestsIn(browser: Browser): Promise<[Page, Page]> {
  const url = await newRoomUrl(browser);
  return [await openRoomAs(browser, url), await openRoomAs(browser, url)];
}

export const fileList = (page: Page) => page.getByRole("complementary", { name: "Files" });

// an open file's button in the tab bar (aria-current="true" when it's the one shown)
export const openTab = (page: Page, name: string | RegExp) =>
  page.getByRole("list", { name: "Open files" }).getByRole("button", { name, exact: true });

// a new file in the room, named in the file list; it opens, ready to type in
export async function newFile(page: Page, name: string) {
  await fileList(page).getByRole("button", { name: "New file" }).click();
  await page.getByLabel("File name").fill(name);
  await page.getByLabel("File name").press("Enter");
}
