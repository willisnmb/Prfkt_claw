import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import SiteNotFound from "./(site)/not-found";

/** Unmatched URLs outside any route segment still get the site shell. */
export default function RootNotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        <SiteNotFound />
      </main>
      <SiteFooter />
    </>
  );
}
