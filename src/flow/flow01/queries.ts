import type { Sql } from "@/server/db/sql";
import { getRun, listApprovals, listEvents, listEvidence, listSideEffects, mapRun, type FlowRun } from "./store";

export async function listRunsForAdmin(sql: Sql, limit = 100): Promise<FlowRun[]> {
  const rows = await sql.query<Record<string, unknown>>("select * from public.flow_runs order by updated_at desc limit $1", [limit]);
  return rows.map(mapRun);
}

export async function getRunDetail(sql: Sql, workflowId: string) {
  const run = await getRun(sql, workflowId);
  if (!run) return undefined;
  const [events, evidence, approvals, sideEffects, audit] = await Promise.all([
    listEvents(sql, workflowId),
    listEvidence(sql, workflowId),
    listApprovals(sql, workflowId),
    listSideEffects(sql, workflowId),
    sql
      .query<{ id: number; actor_email: string; action: string; created_at: Date }>(
        "select id, actor_email, action, created_at from public.admin_audit_log where target_type = 'flow_run' and target_id = $1 order by id",
        [workflowId],
      )
      .catch(() => []),
  ]);
  return { run, events, evidence, approvals, sideEffects, audit };
}
export type RunDetail = NonNullable<Awaited<ReturnType<typeof getRunDetail>>>;
