import { expect, test } from "@playwright/test";

test.describe("custom intake", () => {
  test("shows field errors and focuses the first invalid field", async ({ page }) => {
    await page.goto("/custom");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByTestId("intake-errors")).toBeVisible();
    await expect(page.getByText("Please enter your name.")).toBeVisible();
    await expect(page.getByText("Please enter a valid email address.")).toBeVisible();
    await expect(page.getByText(/at least 20 characters/)).toBeVisible();
    await expect(page.getByText("Please confirm we may contact you about this request.")).toBeVisible();
    const name = page.getByLabel(/^Name/);
    await expect(name).toBeFocused();
    await expect(name).toHaveAttribute("aria-invalid", "true");
  });

  test("honeypot is not visible or focusable", async ({ page }) => {
    await page.goto("/custom");
    const hp = page.getByTestId("honeypot");
    await expect(hp).toBeHidden();
    await expect(hp).toHaveAttribute("tabindex", "-1");
  });

  test("valid submission reaches the server and shows its outcome", async ({ page }) => {
    await page.goto("/custom?slug=invoice-approval");
    await expect(page.getByText("About:")).toContainText("Invoice Approval Workflow");
    await expect(page.getByLabel("Kind of system")).toHaveValue("FLOW");
    await page.getByLabel(/^Name/).fill("Ada Example");
    await page.getByLabel(/^Work email/).fill("ada@example.com");
    await page.getByLabel(/What should the system do/).fill("Route supplier invoices to the right approver and prepare payment batches.");
    await page.getByLabel(/^Data involved/).selectOption("internal");
    await page.getByLabel(/^Timeline/).selectOption("this-quarter");
    await page.getByLabel(/^Budget/).selectOption("5k-25k");
    await page.getByLabel(/You may contact me/).check();
    await page.getByRole("button", { name: "Send request" }).click();
    // Without a configured database the server declines politely; with one it returns a reference.
    await expect(page.getByTestId("intake-success").or(page.getByTestId("intake-server-error"))).toBeVisible();
    await expect(page.getByTestId("intake-errors")).toHaveCount(0);
  });
});
