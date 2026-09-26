import { NextResponse } from "next/server";
import { getOptionalUser } from "@/server/auth/user";
import { getSql } from "@/server/db/postgres";
import { isDatabaseConfigured } from "@/server/env";
import { exportCustomerData } from "@/server/data/export";
import { hitRateLimit, RATE_LIMITS } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

/** Customer data export (JSON download). Runs as the user; RLS limits it to their tenant. */
export async function GET() {
  const noStore = { "Cache-Control": "private, no-store" };
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Sign in to export your data." }, { status: 401, headers: noStore });
  if (!isDatabaseConfigured()) return NextResponse.json({ error: "No database is connected in this environment." }, { status: 503, headers: noStore });
  const sql = getSql();
  if (!(await hitRateLimit(sql, RATE_LIMITS.exportPerUser, user.id))) {
    return NextResponse.json({ error: "Too many exports. Please try again later." }, { status: 429, headers: noStore });
  }
  const data = await exportCustomerData(sql, user.id);
  const date = data.exportedAt.slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      ...noStore,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="prfkt-export-${date}.json"`,
    },
  });
}
