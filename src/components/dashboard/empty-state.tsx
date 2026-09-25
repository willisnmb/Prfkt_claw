import Link from "next/link";
import { Button } from "@/components/ui/button";

export function EmptyState({ title, body, action }: { title: string; body: string; action?: { href: string; label: string } }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
      {action && (
        <Button asChild variant="outline" size="sm" className="mt-4 min-h-11">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      )}
    </div>
  );
}
