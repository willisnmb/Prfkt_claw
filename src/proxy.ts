import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Proxy: request id + Supabase session refresh ONLY.
 *
 * This is deliberately not an authorization layer (see Next.js data-security
 * guidance): every admin page, customer page and server action calls
 * requireOwner()/requireUser() itself. Nothing here grants access.
 */
export async function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  // Always mint our own id; a client-supplied x-request-id is not trusted.
  requestHeaders.set("x-request-id", crypto.randomUUID());

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const hasAuthCookie = request.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));

  // Optimistic UX redirect only: with no session cookie at all, send a real
  // 307 to /login instead of streaming the dashboard shell. It grants nothing —
  // the dashboard layout, page and actions still verify the user server-side.
  const { pathname } = request.nextUrl;
  if (!hasAuthCookie && (pathname === "/dashboard" || (pathname.startsWith("/dashboard/") && !pathname.startsWith("/dashboard/export")))) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    const redirect = NextResponse.redirect(login, 307);
    redirect.headers.set("Cache-Control", "private, no-store");
    return redirect;
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  if (!url || !anonKey || !hasAuthCookie) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, cacheHeaders) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(cacheHeaders ?? {})) response.headers.set(k, v);
      },
    },
  });
  // Refreshes an expiring session and writes the new cookies. Result unused on purpose.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"],
};
