import { expect, test } from "@playwright/test";

test.describe("catalog", () => {
  test("lists 100+ systems with maturity labels and no READY claims", async ({ page }) => {
    await page.goto("/catalog");
    const count = Number(await page.getByTestId("result-count").textContent());
    expect(count).toBeGreaterThanOrEqual(100);
    await expect(page.getByTestId("catalog-card")).toHaveCount(count);
    await expect(page.locator('[data-maturity="READY"]')).toHaveCount(0);
  });

  test("filters from URL search params", async ({ page }) => {
    await page.goto("/catalog?family=EDGE&foundation=voice-reception");
    const cards = page.getByTestId("catalog-card");
    await expect(cards.first()).toBeVisible();
    const families = await cards.evaluateAll((els) => els.map((e) => e.getAttribute("data-family")));
    expect(families.length).toBeGreaterThan(0);
    expect(new Set(families)).toEqual(new Set(["EDGE"]));
    await expect(page.getByLabel("Family")).toHaveValue("EDGE");
    await expect(page.getByLabel("Foundation")).toHaveValue("voice-reception");
  });

  test("changing a filter updates the URL and results", async ({ page }) => {
    await page.goto("/catalog");
    await page.getByLabel("Family").selectOption("STRICT");
    await expect(page).toHaveURL(/family=STRICT/);
    await expect(page.getByTestId("result-count")).toHaveText("13");
    const families = await page.getByTestId("catalog-card").evaluateAll((els) => els.map((e) => e.getAttribute("data-family")));
    expect(new Set(families)).toEqual(new Set(["STRICT"]));
  });

  test("search updates the URL and shows an empty state for no matches", async ({ page }) => {
    await page.goto("/catalog");
    const search = page.getByRole("searchbox", { name: "Search systems" });
    await search.fill("invoice");
    await expect(page).toHaveURL(/q=invoice/);
    await expect(page.getByTestId("catalog-card").first()).toContainText(/invoice/i);
    await search.fill("zzqqxxnothing");
    await expect(page).toHaveURL(/q=zzqqxxnothing/);
    await expect(page.getByText("No systems match.")).toBeVisible();
    await expect(page.getByTestId("result-count")).toHaveText("0");
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/catalog$/);
  });

  test("ignores invalid filter values instead of failing", async ({ page }) => {
    const res = await page.goto("/catalog?family=NOPE&maturity=%3Cscript%3E");
    expect(res?.status()).toBe(200);
    expect(Number(await page.getByTestId("result-count").textContent())).toBeGreaterThanOrEqual(100);
  });
});

test.describe("product page", () => {
  test("shows outcomes, governed actions and hides framework names until asked", async ({ page }) => {
    await page.goto("/catalog/lead-to-customer");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lead-to-Customer Workflow");
    await expect(page.getByRole("heading", { name: "Outcomes" })).toBeVisible();
    const table = page.getByRole("table");
    await expect(table.getByRole("rowheader", { name: /Send externally/ })).toBeVisible();
    await expect(table).toContainText("Needs approval");
    await expect(table).toContainText("Denied");

    const main = page.locator("main");
    await expect(main).not.toContainText("LangGraph", { useInnerText: true });
    await page.getByText("Under the hood").click();
    await expect(main).toContainText("LangGraph", { useInnerText: true });

    await page.getByRole("link", { name: "Configure this system" }).click();
    await expect(page).toHaveURL(/\/configure\?slug=lead-to-customer/);
    await expect(page.getByTestId("recommended-family")).toHaveText("FLOW");
  });
});
