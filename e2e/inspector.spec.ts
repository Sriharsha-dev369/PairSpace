// End-to-end spec for the sync inspector: what someone sees about their own connection to the room.

import { expect, type Page, test } from "@playwright/test";
import { newRoomUrl, openRoomAs } from "./members";

const inspector = (page: Page) => page.getByRole("complementary", { name: "Sync inspector" });

async function openInspector(page: Page) {
  await page.getByRole("button", { name: "Sync inspector" }).click();
  await expect(inspector(page)).toBeVisible();
}

test("the sync inspector shows the connection, its round trip and that every change arrived", async ({
  browser,
}) => {
  const page = await openRoomAs(browser, await newRoomUrl(browser));
  // the status bar shows the round trip, and opens the inspector
  await expect(page.getByRole("button", { name: "Sync inspector" })).toHaveText(/(<1|\d+) ms/);

  await openInspector(page);
  await page.locator(".cm-content").click();
  await page.keyboard.type("hello");

  const panel = inspector(page);
  await expect(panel.getByTestId("sync-connection")).toHaveText("Connected");
  await expect(panel.getByTestId("sync-round-trip")).toHaveText(/^(<1|\d+) ms$/);
  await expect(panel.getByTestId("sync-waiting")).toHaveText("None");
  await expect(panel.getByTestId("sync-last-confirmed")).toHaveText(/just now|\d+ s ago/);

  await panel.getByRole("button", { name: "Close the sync inspector" }).click();
  await expect(inspector(page)).toBeHidden();
});
