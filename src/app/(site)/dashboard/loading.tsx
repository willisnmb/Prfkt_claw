import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="site-container py-10 sm:py-14" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your dashboard…</span>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-9 w-64" />
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-48 lg:col-span-2" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}
