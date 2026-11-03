// End-to-end spec for the sync inspector: what someone sees about their own connection to the room.

import { expect, type Page, test } from "@playwright/test";
import { newRoomUrl, openRoomAs, twoGuestsIn } from "./members";

const inspector = (page: Page) => page.getByRole("complementary", { name: "Sync inspector" });

async function openInspector(page: Page) {
  await page.getByRole("button", { name: /^Sync inspector/ }).click();
  await expect(inspector(page)).toBeVisible();
}

test("the sync inspector shows the connection, its round trip and that every change arrived", async ({
  browser,
}) => {
  const page = await openRoomAs(browser, await newRoomUrl(browser));
  // the status bar shows the round trip, and opens the inspector
  await expect(page.getByRole("button", { name: /^Sync inspector/ })).toHaveText(/(<1|\d+) ms/);

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

// the document as typed: the editor's lines without the other people's cursor labels in them
const typedIn = (page: Page) =>
  page.locator(".cm-content").evaluate((content) =>
    [...content.querySelectorAll(".cm-line")]
      .map((line) => {
        const copy = line.cloneNode(true) as Element;
        for (const caret of copy.querySelectorAll(".cm-ySelectionCaret")) caret.remove();
        return copy.textContent;
      })
      .join("\n"),
  );

const networkChoice = (page: Page, name: string) =>
  inspector(page).getByRole("radio", { name, exact: true });

test("on a slow network, changes wait for the server and reach the others late, and others see why", async ({
  browser,
}) => {
  const [alice, bob] = await twoGuestsIn(browser);
  await openInspector(bob);

  await networkChoice(bob, "Slow").check();
  await expect(alice.getByTestId("network-tag")).toHaveText("simulated slow network");
  await expect(bob.getByRole("button", { name: /^Sync inspector/ })).toContainText("Slow");

  await bob.locator(".cm-content").click();
  await bob.keyboard.type("from bob");
  await expect(inspector(bob).getByTestId("sync-waiting")).not.toHaveText("None");
  await expect(alice.locator(".cm-content")).toContainText("from bob");
  await expect(inspector(bob).getByTestId("sync-waiting")).toHaveText("None");
  await expect(inspector(bob).getByTestId("sync-round-trip")).toHaveText(/^\d+\.\d s$/); // a second or more

  await networkChoice(bob, "Normal").check();
  await expect(alice.getByTestId("network-tag")).toBeHidden();
});

test("offline in the sync inspector, then back: what both people wrote meets", async ({
  browser,
}) => {
  const [alice, bob] = await twoGuestsIn(browser);
  await openInspector(bob);

  await networkChoice(bob, "Offline").check();
  await expect(bob.getByTestId("connection-status")).toHaveText("Offline");
  await bob.locator(".cm-content").click();
  await bob.keyboard.type("bob offline ");
  await alice.locator(".cm-content").click();
  await alice.keyboard.type("alice online ");

  await networkChoice(bob, "Normal").check();
  await expect(bob.getByTestId("connection-status")).toHaveText("Connected");
  for (const page of [alice, bob]) {
    await expect(page.locator(".cm-content")).toContainText("bob offline");
    await expect(page.locator(".cm-content")).toContainText("alice online");
  }
  expect(await typedIn(alice)).toBe(await typedIn(bob));
});

test("the sync inspector logs what goes out and comes in, and graphs the round trip", async ({
  browser,
}) => {
  const page = await openRoomAs(browser, await newRoomUrl(browser));
  await openInspector(page);
  await page.locator(".cm-content").click();
  await page.keyboard.type("x");

  const panel = inspector(page);
  const messages = panel.getByRole("list", { name: "Messages" }).getByRole("listitem");
  await expect(
    messages.filter({ hasText: "Sent" }).filter({ hasText: "Change" }).first(),
  ).toBeVisible();
  await expect(
    messages
      .filter({ hasText: "Received" })
      .filter({ hasText: /Pong \d+/ })
      .first(),
  ).toBeVisible();
  await expect(panel.getByTestId("messages-total")).toHaveText(
    /^Sent \d+ \(.+\), received \d+ \(.+\)$/,
  );
  await expect(
    panel.getByRole("img", { name: /^Round trip over the last minute: latest/ }),
  ).toBeVisible();
});
