import { expect, test } from "@playwright/test";

test.describe("configurator", () => {
  test("recommendation reacts to inputs", async ({ page }) => {
    await page.goto("/configure");
    await expect(page.getByTestId("recommended-family")).toHaveText("CLAW");

    await page.getByTestId("toggle-edgeHardware").click();
    await expect(page.getByTestId("recommended-family")).toHaveText("EDGE");
    await expect(page.getByTestId("recommended-deployment")).toHaveText("Edge device");

    await page.getByTestId("toggle-edgeHardware").click();
    await page.getByText("Air-gapped", { exact: true }).click();
    await expect(page.getByTestId("recommended-model-policy")).toHaveText("Local only");
    await expect(page.getByTestId("recommended-deployment")).toHaveText("On-premises");
  });

  test("switches and options are keyboard operable", async ({ page }) => {
    await page.goto("/configure");
    const toggle = page.getByRole("switch", { name: /Runs on your own small hardware/ });
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("recommended-family")).toHaveText("EDGE");

    const radio = page.getByRole("radio", { name: "Regulated" });
    await radio.focus();
    await page.keyboard.press("Space");
    await expect(radio).toBeChecked();
  });

  test("saving without an account explains how to proceed", async ({ page }) => {
    await page.goto("/configure");
    await page.getByRole("button", { name: "Save configuration" }).click();
    const err = page.getByTestId("save-error");
    await expect(err).toBeVisible();
    await expect(err.getByRole("link", { name: "Sign in to save" })).toHaveAttribute("href", "/login?next=/configure");
  });

  test("request link carries the recommended family", async ({ page }) => {
    await page.goto("/configure");
    await page.getByTestId("toggle-multiAgentBenefit").click();
    await page.getByTestId("toggle-persistentConversation").click();
    await expect(page.getByTestId("recommended-family")).toHaveText("CREW");
    await page.getByRole("link", { name: "Request this build" }).click();
    await expect(page).toHaveURL(/\/custom\?family=CREW/);
    await expect(page.getByLabel("Kind of system")).toHaveValue("CREW");
  });
});
