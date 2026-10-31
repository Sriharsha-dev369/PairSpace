// End-to-end spec for accounts: signing up, in and out, and what guests and members can do.

import { expect, test } from "@playwright/test";
import { memberBrowser, newEmail, PASSWORD } from "./members";

test("signing up takes you into a new room under your account name", async ({ page }) => {
  await page.goto("/sign-up");

  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill(newEmail());
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/r\/[a-z0-9]{10}$/);
  await expect(page.getByTestId("my-name")).toHaveText("Ada Lovelace");
});

test("the home page asks you to sign in when you have no account", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("signing in with a wrong password says so", async ({ browser }) => {
  const email = newEmail();
  const context = await browser.newContext();
  await context.request.post("/api/auth/sign-up/email", {
    headers: { origin: test.info().project.use.baseURL ?? "" },
    data: { name: "Ada", email, password: PASSWORD },
  });
  await context.clearCookies(); // signed up, then signed out: now sign in again
  const page = await context.newPage();
  await page.goto("/sign-in");

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("alert")).toHaveText("Wrong email or password.");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("signing out takes you back to sign in", async ({ browser }) => {
  const page = await (await memberBrowser(browser)).newPage();
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/); // the session really ended
});

test("a guest signing in from a room comes back to it under their account name", async ({
  browser,
}) => {
  const owner = await (await memberBrowser(browser)).newPage();
  await owner.goto("/");
  await expect(owner.locator(".cm-content")).toBeVisible();
  const roomUrl = owner.url();
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(roomUrl);
  await expect(guest.getByText("guest", { exact: true })).toBeVisible();

  await guest.getByRole("link", { name: "Sign in" }).click();
  await guest.getByRole("link", { name: "Create an account" }).click();
  await guest.getByLabel("Name").fill("Grace Hopper");
  await guest.getByLabel("Email").fill(newEmail());
  await guest.getByLabel("Password").fill(PASSWORD);
  await guest.getByRole("button", { name: "Create account" }).click();

  await expect(guest).toHaveURL(roomUrl);
  await expect(guest.getByTestId("my-name")).toHaveText("Grace Hopper");
  await expect(owner.getByTestId("other-person")).toHaveText(["Grace Hopper"]);
});

test("a link to a room that doesn't exist says so", async ({ page }) => {
  await page.goto("/r/nobodymadethis");

  await expect(page.getByText("This room doesn't exist")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to start a room" })).toBeVisible();
});
