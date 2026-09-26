import { MATURITY_DEFINITIONS, type Maturity } from "@/domain/catalog/schema";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const VAR: Record<Maturity, string> = {
  READY: "--maturity-ready",
  CONFIGURABLE: "--maturity-configurable",
  CUSTOM: "--maturity-custom",
};

/**
 * Maturity label with its definition. The trigger is a button so the
 * definition is reachable by keyboard; the definition is also exposed to
 * screen readers via aria-describedby-style sr-only text.
 */
export function MaturityBadge({ maturity, className }: { maturity: Maturity; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[0.68rem] tracking-wider uppercase focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
            className,
          )}
          style={{
            color: `var(${VAR[maturity]})`,
            borderColor: `color-mix(in oklch, var(${VAR[maturity]}) 45%, transparent)`,
            backgroundColor: `color-mix(in oklch, var(${VAR[maturity]}) 10%, transparent)`,
          }}
          data-maturity={maturity}
        >
          <span aria-hidden="true" className="size-1.5 rounded-full" style={{ backgroundColor: `var(${VAR[maturity]})` }} />
          {maturity}
          <span className="sr-only">: {MATURITY_DEFINITIONS[maturity]}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-pretty">{MATURITY_DEFINITIONS[maturity]}</TooltipContent>
    </Tooltip>
  );
}
