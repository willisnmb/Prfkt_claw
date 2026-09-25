import { expect, test } from "@playwright/test";

/**
 * Owner control plane and customer dashboard fail closed. In CI no identity
 * provider is configured, which is exactly the "signed out" case: every
 * protected route must redirect to /login without rendering protected content,
 * and no query/cookie/header trick may change that.
 */

const ADMIN_ROUTES = [
  "/admin",
  "/admin/catalog",
  "/admin/requests",
  "/admin/provisioning",
  "/admin/flows",
  "/admin/flows/00000000-0000-4000-8000-000000000000",
  "/admin/runtimes",
  "/admin/models",
  "/admin/compute",
  "/admin/security",
  "/admin/audit",
  "/admin/system",
];

// Text that only appears in rendered admin page bodies (not in route names or <title>).
const PROTECTED_MARKERS = [
  // The admin layout's landmark id. (A generic "Skip to content" also appears in the
  // public site header, which Next serialises into every response as the 404 boundary.)
  "admin-main",
  "Append-only record of owner actions",
  "Feature flags",
  "Deployment reviews",
  "Configured owners",
  "Record release-gate evidence",
  "Deliberately not customer runtimes",
  "Approved, not yet queued",
];

test.describe("owner control plane is not reachable signed out", () => {
  for (const route of ADMIN_ROUTES) {
    test(`${route} redirects to /login without leaking content`, async ({ request }) => {
      const res = await request.get(route, { maxRedirects: 0 });
      expect([303, 307, 308]).toContain(res.status());
      const location = res.headers()["location"] ?? "";
      expect(location).toMatch(/^\/login\?next=%2Fadmin|^\/login\?next=\/admin/);
      const body = await res.text();
      for (const marker of PROTECTED_MARKERS) expect(body).not.toContain(marker);
    });
  }

  const BYPASS_ATTEMPTS: Array<{ name: string; url: string; headers?: Record<string, string> }> = [
    { name: "query admin=1", url: "/admin?admin=1" },
    { name: "query key", url: "/admin?key=owner&token=letmein" },
    { name: "query isAdmin", url: "/admin/system?isAdmin=true&role=owner" },
    { name: "cookie isAdmin", url: "/admin", headers: { cookie: "isAdmin=true; role=owner; admin=1" } },
    { name: "fake supabase cookie", url: "/admin", headers: { cookie: "sb-project-auth-token=%7B%22access_token%22%3A%22forged%22%7D" } },
    { name: "header x-admin", url: "/admin", headers: { "x-admin": "1", "x-user-role": "owner", "x-user-email": "owner@prfkt.test" } },
    { name: "bearer token", url: "/admin/audit", headers: { authorization: "Bearer forged.jwt.token" } },
    { name: "forwarded host", url: "/admin", headers: { "x-forwarded-host": "localhost", "x-middleware-subrequest": "proxy:proxy:proxy:proxy:proxy" } },
  ];
  for (const attempt of BYPASS_ATTEMPTS) {
    test(`bypass attempt is still redirected: ${attempt.name}`, async ({ request }) => {
      const res = await request.get(attempt.url, { maxRedirects: 0, headers: attempt.headers });
      expect([303, 307, 308]).toContain(res.status());
      expect(res.headers()["location"] ?? "").toMatch(/^\/login/);
    });
  }

  test("admin responses are no-store and noindex", async ({ request }) => {
    const res = await request.get("/admin", { maxRedirects: 0 });
    expect(res.headers()["cache-control"] ?? "").toContain("no-store");
    expect(res.headers()["x-robots-tag"] ?? "").toContain("noindex");
  });

  test("browser lands on the sign-in page", async ({ page }) => {
    await page.goto("/admin/catalog");
    await expect(page).toHaveURL(/\/login\?next=(%2F|\/)admin/);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByTestId("auth-not-configured")).toBeVisible();
  });
});

test.describe("customer dashboard fails closed", () => {
  test("/dashboard with a forged session cookie still never renders customer data", async ({ request }) => {
    const res = await request.get("/dashboard", { headers: { cookie: "sb-project-auth-token=forged" } });
    const body = await res.text();
    for (const marker of ["Saved configurations", "Deployment requests", "Export my data", "Runtime cells"]) expect(body).not.toContain(marker);
  });

  test("/dashboard redirects to /login", async ({ request }) => {
    const res = await request.get("/dashboard", { maxRedirects: 0 });
    expect([303, 307, 308]).toContain(res.status());
    expect(res.headers()["location"] ?? "").toMatch(/^\/login\?next=%2Fdashboard/);
    expect(res.headers()["cache-control"] ?? "").toContain("no-store");
  });

  test("/dashboard/export refuses without a session", async ({ request }) => {
    const res = await request.get("/dashboard/export", { maxRedirects: 0 });
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: "Sign in to export your data." });
  });
});

test.describe("sign-in page", () => {
  test("renders the not-configured state with security headers", async ({ page }) => {
    const res = await page.goto("/login");
    expect(res?.status()).toBe(200);
    const h = res!.headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByText("Sign-in is not configured in this environment")).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse the catalog" })).toBeVisible();
  });

  test("shows a clear message for a rejected owner", async ({ page }) => {
    await page.goto("/login?next=/admin&error=not-authorized");
    await expect(page.getByText("does not have access to the owner control plane")).toBeVisible();
  });

  test("the not-configured state is keyboard reachable", async ({ page, browserName }, testInfo) => {
    test.skip(testInfo.project.name === "iphone" || testInfo.project.name === "android", "no hardware keyboard on touch profiles");
    test.skip(browserName === "webkit", "WebKit does not Tab to links by default (Option+Tab); covered on Chromium");
    await page.goto("/login");
    const link = page.getByRole("link", { name: "Browse the catalog" });
    for (let i = 0; i < 40 && !(await link.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
  });

  test("off-site next parameters are ignored", async ({ page }) => {
    await page.goto("/login?next=https://evil.example/steal");
    // The page must not render an off-site link for the post-login destination.
    const hrefs = await page.locator("a").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    expect(hrefs.some((h) => h.includes("evil.example"))).toBe(false);
  });
});
