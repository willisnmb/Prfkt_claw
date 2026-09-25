import Link from "next/link";
import { FAMILIES, type FamilyId } from "@/domain/families";
import { cn } from "@/lib/utils";

export function FamilyChip({ family, href, className }: { family: FamilyId; href?: string; className?: string }) {
  const f = FAMILIES[family];
  const style = {
    color: `var(${f.accentVar})`,
    borderColor: `color-mix(in oklch, var(${f.accentVar}) 40%, transparent)`,
  };
  const cls = cn("inline-flex h-6 items-center rounded-md border px-2 font-mono text-[0.68rem] font-medium tracking-widest uppercase", className);
  if (href) {
    return (
      <Link href={href} className={cn(cls, "hover:bg-muted")} style={style}>
        {f.name}
      </Link>
    );
  }
  return (
    <span className={cls} style={style}>
      {f.name}
    </span>
  );
}
