import { expect, test } from "@playwright/test";

test("primary navigation works with the keyboard at this viewport", async ({ page }) => {
  await page.goto("/");
  const menuButton = page.getByRole("button", { name: "Open menu" });

  if (await menuButton.isVisible()) {
    // Phones and narrow screens: sheet navigation.
    const box = await menuButton.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await menuButton.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Menu" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Workflows" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(menuButton).toBeFocused();

    await menuButton.click();
    await dialog.getByRole("link", { name: "Private AI" }).click();
    await expect(page).toHaveURL(/\/private-ai$/);
    await expect(dialog).toBeHidden();
  } else {
    // Desktop: dropdown navigation.
    const systems = page.getByRole("button", { name: "Systems", exact: true });
    await systems.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await systems.click();
    await page.getByRole("menuitem", { name: /Workflows/ }).click();
    await expect(page).toHaveURL(/\/workflows$/);
  }
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
