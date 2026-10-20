// End-to-end spec: real browsers, real web app, real sync server (started by playwright.config.ts).

import { expect, test } from "@playwright/test";

test("opening the home page takes you to a new room link", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/r\/[a-z0-9]{10}$/);
});
