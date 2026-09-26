import type { Page } from "@playwright/test";

export const PUBLIC_ROUTES = [
  "/",
  "/catalog",
  "/catalog/lead-to-customer",
  "/assistants",
  "/crews",
  "/workflows",
  "/apps",
  "/private-ai",
  "/edge",
  "/enterprise",
  "/foundations",
  "/configure",
  "/custom",
  "/pricing",
  "/security",
  "/compute",
  "/privacy",
  "/terms",
  "/support",
] as const;

/** Collects console errors and uncaught page errors for the lifetime of the page. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/** Horizontal overflow in CSS pixels (0 = none). */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
