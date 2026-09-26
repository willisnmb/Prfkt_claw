import Link from "next/link";
import { COMPANY_NAME, CONTACTS_ARE_PLACEHOLDERS, FOOTER_GROUPS, PRODUCT_NAME, SECURITY_CONTACT, SUPPORT_EMAIL } from "./site-config";
import { Logo } from "./logo";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border/70 bg-card/40 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="site-container grid gap-10 py-12 md:grid-cols-[1.2fr_2fr]">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-sm text-sm text-muted-foreground">
            Finished AI systems, each in its own isolated cell, governed by one security layer.
          </p>
          <p className="text-sm text-muted-foreground">
            Support: <a className="underline underline-offset-4 hover:text-foreground" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            <br />
            Security: <a className="underline underline-offset-4 hover:text-foreground" href={`mailto:${SECURITY_CONTACT}`}>{SECURITY_CONTACT}</a>
          </p>
          {CONTACTS_ARE_PLACEHOLDERS && (
            <p className="text-xs text-warning">Placeholder contact addresses — not yet monitored.</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {FOOTER_GROUPS.map((g) => (
            <nav key={g.title} aria-label={g.title}>
              <h2 className="font-mono text-[0.7rem] tracking-widest text-muted-foreground uppercase">{g.title}</h2>
              <ul className="mt-3 space-y-1">
                {g.links.map((l) => (
                  <li key={l.href + l.label}>
                    <Link href={l.href} className="inline-flex min-h-9 items-center text-sm text-muted-foreground hover:text-foreground">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
      <div className="site-container flex flex-col gap-2 border-t border-border/50 pt-6 text-xs text-muted-foreground sm:flex-row sm:justify-between">
        <p>
          © {new Date().getFullYear()} {COMPANY_NAME}. {PRODUCT_NAME} is a {COMPANY_NAME} product. All systems subject to acceptance before go-live.
        </p>
        <p className="font-mono">Billing and provisioning: not yet enabled</p>
      </div>
    </footer>
  );
}
