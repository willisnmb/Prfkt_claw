import { expect, test } from "@playwright/test";
import { PUBLIC_ROUTES, horizontalOverflow, watchErrors } from "./helpers";

test.describe("public routes", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} renders a heading without errors or horizontal scroll`, async ({ page }) => {
      const errors = watchErrors(page);
      const res = await page.goto(route);
      expect(res?.status(), route).toBe(200);
      await expect(page.locator("h1").first()).toBeVisible();
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.getByRole("banner")).toBeVisible();
      await expect(page.getByRole("contentinfo")).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await horizontalOverflow(page), `${route} overflows horizontally`).toBeLessThanOrEqual(0);
      expect(errors, errors.join("\n")).toEqual([]);
    });
  }

  test("unknown catalog item returns 404 with the site shell", async ({ page }) => {
    const res = await page.goto("/catalog/definitely-not-a-system");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("could not find");
    await expect(page.getByRole("link", { name: "Browse the catalog" })).toBeVisible();
  });

  test("skip link moves focus to main content", async ({ page }) => {
    await page.goto("/");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await skip.focus();
    await expect(skip).toBeVisible();
    await skip.press("Enter");
    await expect(page).toHaveURL(/#main$/);
    await expect(page.locator("main#main")).toBeFocused();
  });
});
