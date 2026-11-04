import { expect, test } from "@playwright/test";

// the app's code ran: the home page set its own title (index.html's is plain "PairSpace")
test("the app loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("PairSpace – code together in real time");
});
