// End-to-end spec for accounts: signing up, in and out, and what guests and members can do.

import { expect, test } from "@playwright/test";
import { createRoom, memberBrowser, newEmail, PASSWORD } from "./members";

test("signing up takes you to your rooms, and you're in them under your account name", async ({
  page,
}) => {
  await page.goto("/sign-up");

  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill(newEmail());
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("heading", { name: "Your rooms" })).toBeVisible();
  await page.getByRole("button", { name: "New room" }).first().click();
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
  await expect(page.getByRole("heading", { name: "Your rooms" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/); // the session really ended
});

test("a guest signing in from a room comes back to it under their account name", async ({
  browser,
}) => {
  const ownerBrowser = await memberBrowser(browser);
  const owner = await ownerBrowser.newPage();
  await owner.goto(`/r/${await createRoom(ownerBrowser)}`);
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

test("the GitHub button takes you to GitHub's sign-in", async ({ page }) => {
  // the e2e server has a placeholder GitHub app (playwright.config.ts); GitHub itself isn't called
  await page.route("https://github.com/**", (route) => route.fulfill({ body: "GitHub sign-in" }));
  await page.goto("/sign-in");

  await page.getByRole("button", { name: "Continue with GitHub" }).click();

  await expect(page).toHaveURL(
    /^https:\/\/github\.com\/login\/oauth\/authorize\?.*client_id=e2e-github-app/,
  );
});

test("a GitHub sign-in that didn't work says so", async ({ page }) => {
  await page.goto("/sign-in?error=access_denied"); // where GitHub's failures land

  await expect(page.getByRole("alert")).toHaveText(
    "Signing in with GitHub didn't work. Please try again.",
  );
});
