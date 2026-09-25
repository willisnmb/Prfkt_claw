import type { Metadata } from "next";
import { AdminEmpty, AdminPageHeader, fmtDate, RequireDatabase } from "@/components/admin/admin-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireOwner } from "@/server/auth/owner";
import { getSql } from "@/server/db/postgres";
import { AuditFilter, listAudit } from "@/server/data/admin";

export const metadata: Metadata = { title: "Audit" };

export default async function AdminAuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireOwner();
  const sp = await searchParams;
  const parsed = AuditFilter.safeParse({ action: typeof sp.action === "string" && sp.action ? sp.action : undefined, limit: sp.limit ?? 100 });
  const filter = parsed.success ? parsed.data : { limit: 100 };
  return (
    <>
      <AdminPageHeader title="Audit log" description="Append-only record of owner actions. Updates and deletes are refused by the database, including for its owner." />
      <form role="search" className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="action" className="text-xs text-muted-foreground">
            Action prefix
          </label>
          <Input id="action" name="action" defaultValue={filter.action} placeholder="e.g. deployment." className="h-11 w-56" />
        </div>
        <Button type="submit" variant="outline" className="min-h-11">
          Filter
        </Button>
      </form>
      <RequireDatabase>
        <Audit filter={filter} />
      </RequireDatabase>
    </>
  );
}

async function Audit({ filter }: { filter: { action?: string; limit: number } }) {
  const rows = await listAudit(getSql(), filter);
  if (rows.length === 0) return <AdminEmpty>No audit entries match.</AdminEmpty>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Actor</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Target</TableHead>
          <TableHead>Change</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="whitespace-nowrap">{fmtDate(r.created_at)}</TableCell>
            <TableCell className="break-all">{r.actor_email}</TableCell>
            <TableCell className="font-mono text-xs">{r.action}</TableCell>
            <TableCell className="font-mono text-xs break-all">
              {r.target_type}
              {r.target_id ? `:${r.target_id}` : ""}
            </TableCell>
            <TableCell className="max-w-md">
              <code className="block font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground">
                {r.before !== null ? `before ${JSON.stringify(r.before)}\n` : ""}
                {r.after !== null ? `after ${JSON.stringify(r.after)}` : ""}
              </code>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
