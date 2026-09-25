import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TONES: Record<string, "ok" | "warn" | "bad" | "info" | "muted"> = {
  APPROVED: "ok",
  ACTIVE: "ok",
  SUCCEEDED: "ok",
  CONVERTED: "ok",
  DELIVERED: "ok",
  healthy: "ok",
  connected: "ok",
  embedded: "ok",
  "restore-verified": "ok",
  succeeded: "ok",
  PENDING_REVIEW: "warn",
  RECEIVED: "info",
  TRIAGED: "info",
  SCOPED: "info",
  QUEUED: "info",
  RUNNING: "info",
  PROVISIONING: "info",
  REQUESTED: "warn",
  BLOCKED: "warn",
  degraded: "warn",
  candidate: "warn",
  "not-configured": "muted",
  NOT_PROVISIONED: "muted",
  CANCELLED: "muted",
  unknown: "muted",
  none: "muted",
  disabled: "muted",
  REJECTED: "bad",
  DECLINED: "bad",
  FAILED: "bad",
  failed: "bad",
  down: "bad",
  SUSPENDED: "bad",
  DESTROYED: "muted",
};

const TONE_CLASS = {
  ok: "border-success/40 bg-success/10 text-success",
  warn: "border-warning/40 bg-warning/10 text-warning",
  bad: "border-destructive/40 bg-destructive/10 text-destructive",
  info: "border-[var(--family-flow)]/40 bg-[var(--family-flow)]/10 text-[var(--family-flow)]",
  muted: "border-border bg-muted text-muted-foreground",
} as const;

/** Status label with colour and text (never colour alone). */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = TONES[status] ?? "muted";
  return (
    <Badge variant="outline" className={cn("font-mono text-[0.7rem] tracking-wide uppercase", TONE_CLASS[tone], className)}>
      {status.replaceAll("_", " ").replaceAll("-", " ")}
    </Badge>
  );
}
