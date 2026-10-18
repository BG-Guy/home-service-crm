import { type NextRequest, NextResponse } from "next/server";
import {
  parseSessionCookie,
  REMEMBER_TTL_MS,
  secureCookiesEnabled,
  sessionCookieName,
} from "@/lib/auth/cookie-name";
import { isPublicPath } from "@/lib/auth/public-paths";

// Optimistic auth redirect (SPEC §3.1): app routes without a session cookie go to
// /login. No DB calls — real validation happens in getCurrentUser()/requireUser().
// Also slides the expiry of "remember me" cookies.

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const secure = secureCookiesEnabled();
  const name = sessionCookieName(secure);
  const value = req.cookies.get(name)?.value;

  if (!value && !isPublicPath(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search =
      pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next();
  if (value && parseSessionCookie(value)?.remember) {
    res.cookies.set(name, value, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(REMEMBER_TTL_MS / 1000),
    });
  }
  return res;
}

export const config = {
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon\\.ico|sw\\.js|embed\\.js|manifest\\.webmanifest|robots\\.txt|icons/|icon|apple-icon).*)",
  ],
};
