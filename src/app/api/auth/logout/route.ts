import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { logout } from "@/lib/auth/flows";
import { clearSessionCookie } from "@/lib/auth/session";

// POST /api/auth/logout — the "Sign out" row in More / the sidebar (a plain <form method="post">).
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (user) await logout(user.sessionId);
  await clearSessionCookie();
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
