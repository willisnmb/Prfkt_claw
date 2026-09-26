import { requireUser } from "@/server/auth/user";

// Runs above the page's loading boundary so a signed-out request gets a real
// HTTP redirect instead of a streamed skeleton. The page checks again.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  await requireUser("/dashboard");
  return <>{children}</>;
}
