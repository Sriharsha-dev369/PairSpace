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
