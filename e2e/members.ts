// Helpers for signed-in browsers. Only members create rooms; people they invite join as guests.

import { type Browser, type BrowserContext, expect, test } from "@playwright/test";

export const PASSWORD = "correct horse battery";
export const newEmail = () => `${crypto.randomUUID()}@example.com`;

// signs a browser up the quick way, straight through the accounts API (the pages have own tests)
export async function signUp(context: BrowserContext, name = "Room Owner") {
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

// the room's edit link, as its owner gets it from Share: the invite for anyone else
export async function shareLink(context: BrowserContext, roomId: string): Promise<string> {
  const origin = test.info().project.use.baseURL ?? "";
  const response = await context.request.post(`/api/rooms/${roomId}/links`, {
    headers: { origin },
    data: { role: "editor" },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return `/join/${(await response.json()).code}`;
}
