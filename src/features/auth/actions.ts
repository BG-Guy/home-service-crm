"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { action, actionFailure, formDataToObject } from "@/lib/action";
import { getCurrentUser } from "@/lib/auth/current";
import {
  DEMO_ROLES,
  demoLogin,
  demoLoginPassword,
} from "@/lib/auth/demo-logins";
import type { NewSession } from "@/lib/auth/flows";
import {
  acceptInvite,
  changePassword,
  completePasswordReset,
  createInvite,
  createPasswordResetLink,
  login,
  logout,
  requestPasswordReset,
  revokeInvite,
  signup,
} from "@/lib/auth/flows";
import { safeNextPath } from "@/lib/auth/safe-next";
import {
  clearSessionCookie,
  requestMeta,
  revokeAllSessions,
  setSessionCookie,
} from "@/lib/auth/session";
import type { ActionResult } from "@/lib/types";

// Auth server actions (SPEC M01). Used by the (auth) pages with useActionState:
//   const [state, formAction] = useActionState(loginAction, null)
// Each returns ActionResult; on success it sets the session cookie and redirects.
// Redirects without an explicit `next` go to "/", which (app)/page.tsx sends to the
// role home (admin → /insights, office/tech → /today).

type Input = FormData | Record<string, unknown>;
const toObj = (i: Input) => (i instanceof FormData ? formDataToObject(i) : i);
const pickInput = (args: unknown[]): Input =>
  (args.length >= 2 ? args[1] : args[0]) as Input;

/** Only same-site relative paths are allowed as post-login redirects. */
function safeNext(next: unknown, fallback = "/"): string {
  return safeNextPath(next) ?? fallback;
}

async function startSession(s: NewSession): Promise<void> {
  await setSessionCookie(s.cookieValue, s.remember, s.expiresAt);
}

export async function signupAction(
  ...args: unknown[]
): Promise<ActionResult<{ status: "active" | "pending" }>> {
  const input = toObj(pickInput(args));
  let res: Awaited<ReturnType<typeof signup>>;
  try {
    res = await signup(input as never, await requestMeta());
  } catch (err) {
    return actionFailure(err);
  }
  if (res.session) {
    await startSession(res.session);
    redirect("/");
  }
  return { ok: true, data: { status: res.status } };
}

export async function loginAction(...args: unknown[]): Promise<ActionResult> {
  const input = toObj(pickInput(args));
  let s: NewSession;
  try {
    s = await login(input as never, await requestMeta());
  } catch (err) {
    return actionFailure(err);
  }
  await startSession(s);
  redirect(safeNext((input as { next?: unknown }).next));
}

/**
 * Demo businesses only: one-tap sign-in as the first admin / office / tech
 * (`src/lib/auth/demo-logins.ts`). Off unless DEMO_LOGIN_PASSWORD is set; still
 * goes through login(), so a changed password or the throttle stops it.
 */
export async function demoLoginAction(role: string): Promise<ActionResult> {
  const password = demoLoginPassword();
  const r = DEMO_ROLES.find((x) => x === role);
  if (!password || !r)
    return { ok: false, error: "Quick sign-in is off here." };
  const u = await demoLogin(r);
  if (!u) return { ok: false, error: `No active ${r} user to sign in as.` };
  let s: NewSession;
  try {
    s = await login(
      { email: u.email, password, remember: true },
      await requestMeta(),
    );
  } catch (err) {
    return actionFailure(err);
  }
  await startSession(s);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const user = await getCurrentUser();
  if (user) await logout(user.sessionId);
  await clearSessionCookie();
  redirect("/login");
}

export async function acceptInviteAction(
  ...args: unknown[]
): Promise<ActionResult> {
  const input = toObj(pickInput(args));
  let s: NewSession;
  try {
    s = await acceptInvite(input as never, await requestMeta());
  } catch (err) {
    return actionFailure(err);
  }
  await startSession(s);
  redirect("/");
}

export async function requestPasswordResetAction(
  ...args: unknown[]
): Promise<ActionResult> {
  const input = toObj(pickInput(args)) as { email?: unknown };
  try {
    await requestPasswordReset(String(input.email ?? ""), await requestMeta());
  } catch (err) {
    const f = actionFailure(err);
    // Never reveal whether the account exists; only rate limits surface.
    if (f.error.startsWith("Too many")) return f;
  }
  return { ok: true };
}

export async function completePasswordResetAction(
  ...args: unknown[]
): Promise<ActionResult> {
  const input = toObj(pickInput(args));
  let s: NewSession;
  try {
    s = await completePasswordReset(input as never, await requestMeta());
  } catch (err) {
    return actionFailure(err);
  }
  await startSession(s);
  redirect("/");
}

export const changePasswordAction = action({
  name: "auth.change_password",
  input: z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(1),
  }),
  async run({ input, user }) {
    await changePassword(
      user.id,
      input.currentPassword,
      input.newPassword,
      user.sessionId,
      await requestMeta(),
    );
  },
});

export const signOutOtherDevicesAction = action({
  name: "auth.sign_out_others",
  input: z.object({}).optional(),
  audit: "user.sessions_revoked",
  async run({ tx, user }) {
    return {
      revoked: await revokeAllSessions(tx, user.id, {
        exceptSessionId: user.sessionId,
      }),
    };
  },
});

export const createInviteAction = action({
  name: "auth.create_invite",
  perm: "users.invite",
  input: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.preprocess(
      (v) => (v === "" ? null : v),
      z.email().nullable().optional(),
    ),
    phone: z.preprocess(
      (v) => (v === "" ? null : v),
      z.string().trim().max(40).nullable().optional(),
    ),
    role: z.string().min(1),
    workerType: z.enum(["w2", "1099"]).default("1099"),
  }),
  async run({ tx, input, actor }) {
    const r = await createInvite(tx, input, actor);
    return {
      inviteId: r.inviteId,
      url: r.url,
      expiresAt: r.expiresAt.toISOString(),
    };
  },
  revalidate: () => ["/team"],
});

export const revokeInviteAction = action({
  name: "auth.revoke_invite",
  perm: "users.invite",
  input: z.object({ inviteId: z.uuid() }),
  async run({ tx, input, actor }) {
    await revokeInvite(tx, input.inviteId, actor);
  },
  revalidate: () => ["/team"],
});

export const createResetLinkAction = action({
  name: "auth.create_reset_link",
  perm: "users.manage",
  input: z.object({ userId: z.uuid() }),
  async run({ tx, input, actor }) {
    const r = await createPasswordResetLink(tx, input.userId, actor);
    return { url: r.url, expiresAt: r.expiresAt.toISOString() };
  },
});
