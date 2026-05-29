import { test, expect } from "@playwright/test";
test("create deal flow", async ({ page }) => {
  await page.goto("http://localhost:5173");
  await expect(page).toHaveTitle(/CBDC/);
});
