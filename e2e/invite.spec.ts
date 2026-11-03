// End-to-end spec for arriving by invite: the guest names themselves once, sees whose room it is
// and who's there, and anyone can rename themselves later.

import { type Browser, expect, type Page, test } from "@playwright/test";
import { createRoom, memberBrowser, shareLink, twoGuestsIn } from "./members";

// a member with a room open (so they're "here now"), and its invite link
async function ownerInRoom(browser: Browser, title: string) {
  const owner = await memberBrowser(browser, {}, "Ada Lovelace");
  const roomId = await createRoom(owner, title);
  const page = await owner.newPage();
  await page.goto(`/r/${roomId}`);
  await expect(page.locator(".cm-content")).toBeVisible();
  return { page, link: await shareLink(owner, roomId), context: owner };
}

const others = (page: Page) => page.getByTestId("other-person");

test("an invited guest names themselves first, seeing whose room it is and who's there", async ({
  browser,
}) => {
  const ada = await ownerInRoom(browser, "Interview prep");
  const guest = await (await browser.newContext()).newPage();

  await guest.goto(ada.link);

  await expect(guest.getByText("Ada Lovelace invited you to")).toBeVisible();
  await expect(guest.getByRole("heading", { name: "Interview prep" })).toBeVisible();
  await expect(guest.getByTestId("here-now")).toContainText("Ada Lovelace");
  await expect(others(ada.page)).toHaveCount(0); // watching from the screen, not in the room yet

  await guest.getByLabel("Your name").fill("Grace Hopper");
  await guest.getByRole("button", { name: "Join room" }).click();

  await expect(guest.locator(".cm-content")).toBeVisible();
  await expect(guest.getByTestId("my-name")).toHaveText("Grace Hopper");
  await expect(others(ada.page)).toHaveText(["Grace Hopper"]);
});

test("the name screen won't join without a name", async ({ browser }) => {
  const ada = await ownerInRoom(browser, "Interview prep");
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(ada.link);

  await guest.getByLabel("Your name").fill("   ");
  await guest.getByRole("button", { name: "Join room" }).click();

  await expect(guest.getByText("Enter a name")).toBeVisible();
  await expect(guest.locator(".cm-content")).toBeHidden();
});

test("a guest who has named themselves goes straight in next time", async ({ browser }) => {
  const ada = await ownerInRoom(browser, "Interview prep");
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(ada.link);
  await guest.getByLabel("Your name").fill("Grace Hopper");
  await guest.getByRole("button", { name: "Join room" }).click();
  await expect(guest.locator(".cm-content")).toBeVisible();

  const second = await shareLink(ada.context, await createRoom(ada.context, "Algorithms club"));
  await guest.goto(second);

  await expect(guest.locator(".cm-content")).toBeVisible();
  await expect(guest.getByTestId("my-name")).toHaveText("Grace Hopper");
});

test("you rename yourself from your own name, and the others see it at once", async ({
  browser,
}) => {
  const [alice, bob] = await twoGuestsIn(browser);

  await alice.getByRole("button", { name: "Change your name" }).click();
  await alice.getByLabel("Your name").fill("Grace");
  await alice.getByLabel("Your name").press("Enter");

  await expect(alice.getByTestId("my-name")).toHaveText("Grace");
  await expect(others(bob)).toHaveText(["Grace"]);
  await alice.reload();
  await expect(alice.getByTestId("my-name")).toHaveText("Grace"); // remembered by this browser
});

test("a member's new name is their account's, everywhere", async ({ browser }) => {
  const ada = await ownerInRoom(browser, "Interview prep");

  await ada.page.getByRole("button", { name: "Change your name" }).click();
  await ada.page.getByLabel("Your name").fill("Ada King");
  await ada.page.getByLabel("Your name").press("Enter");

  await expect(ada.page.getByTestId("my-name")).toHaveText("Ada King");
  await ada.page.goto("/");
  await expect(ada.page.getByText("Ada King")).toBeVisible(); // the dashboard's header
});
