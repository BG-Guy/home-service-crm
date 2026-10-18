import "server-only";
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { sendSystemEmail } from "@/adapters/email";
import { db, type Tx } from "@/db";
import {
  company,
  invites,
  loginAttempts,
  passwordResets,
  roles,
  users,
} from "@/db/schema";
import { writeAudit } from "../audit";
import { appUrl } from "../env";
import {
  ConflictError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "../errors";
import { emit } from "../events";
import { toBaseRole } from "../permissions";
import { normalizePhone } from "../phone";
import { assertRateLimit } from "../ratelimit";
import { getSettings } from "../settings";
import { isValidTimeZone } from "../time";
import { hashToken, newTokenPair } from "../tokens";
import { type Actor, SYSTEM_ACTOR } from "../types";
import {
  checkPasswordPolicy,
  dummyPasswordHash,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "./password";
import { createSession, type RequestMeta, revokeAllSessions } from "./session";

// Auth flows (SPEC M01, §3.3). Pure server logic: no cookies here — the 'use server'
// actions in src/features/auth/actions.ts call these and set the cookie.

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 30 * 60 * 1000;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILS_PER_EMAIL = 5;
export const MAX_FAILS_PER_IP = 20;

const GENERIC_LOGIN_ERROR = "Email or password is incorrect.";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: "Enter a valid email." }));

/** zod parse that throws ValidationError (fieldErrors keyed by path) instead of ZodError. */
function parseInput<T>(schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.length ? issue.path.map(String).join(".") : "_";
    fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
  }
  throw new ValidationError(fieldErrors);
}

export interface NewSession {
  cookieValue: string;
  sessionId: string;
  expiresAt: Date;
  remember: boolean;
  userId: string;
}

// ------------------------------------------------------------------ signup

export const SignupSchema = z.object({
  companyName: z.string().trim().min(2, "Enter your company name.").max(120),
  name: z.string().trim().min(2, "Enter your name.").max(120),
  email,
  phone: z.string().trim().max(40).optional().nullable(),
  password: z.string().min(1, "Enter a password."),
  timezone: z.string().trim().default("America/New_York"),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Use a 2-letter state code.")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  tradePreset: z.string().trim().default("generic"),
  remember: z.coerce.boolean().default(true),
});
export type SignupInput = z.input<typeof SignupSchema>;

export interface SignupResult {
  userId: string;
  status: "active" | "pending";
  createdCompany: boolean;
  session: NewSession | null;
}

/**
 * First signup creates the company + first admin (SPEC §3.3). Afterwards signups are
 * invite-only, unless settings.auth.open_signup — then they land as `pending` users.
 */
export async function signup(
  raw: SignupInput,
  meta: RequestMeta = {},
): Promise<SignupResult> {
  const input = parseInput(SignupSchema, raw);
  const policy = checkPasswordPolicy(input.password, {
    email: input.email,
    name: input.name,
    company: input.companyName,
  });
  if (policy) throw new ValidationError({ password: [policy] });
  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (input.phone && !phone)
    throw new ValidationError({ phone: ["Enter a valid mobile number."] });
  const timezone = isValidTimeZone(input.timezone)
    ? input.timezone
    : "America/New_York";
  const passwordHash = await hashPassword(input.password);

  const companyRow = await db
    .select({ id: company.id })
    .from(company)
    .where(eq(company.id, 1))
    .limit(1);
  const hasCompany = companyRow.length > 0;
  const openSignup = hasCompany
    ? (await getSettings()).auth.open_signup
    : false;
  if (hasCompany && !openSignup) {
    throw new ConflictError(
      "signup_closed",
      "This workspace is invite-only. Ask your admin for an invite.",
    );
  }

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);
    if (existing.length)
      throw new ValidationError({
        email: ["An account with this email already exists."],
      });

    let createdCompany = false;
    let role = "admin";
    let status: "active" | "pending" = "active";
    if (!hasCompany) {
      const inserted = await tx
        .insert(company)
        .values({
          id: 1,
          name: input.companyName,
          legalName: input.companyName,
          email: input.email,
          phone,
          timezone,
          state: input.state ?? null,
          settings: { company: { trade_preset: input.tradePreset } },
        })
        .onConflictDoNothing()
        .returning({ id: company.id });
      if (inserted.length === 0) {
        throw new ConflictError(
          "signup_closed",
          "This workspace was just created. Ask your admin for an invite.",
        );
      }
      createdCompany = true;
    } else {
      role = (await getSettings()).auth.open_signup_role || "tech";
      status = "pending";
    }

    const [user] = await tx
      .insert(users)
      .values({
        email: input.email,
        phone,
        name: input.name,
        role,
        status,
        passwordHash,
        esignConsentAt: createdCompany ? new Date() : null,
        lastLoginAt: status === "active" ? new Date() : null,
      })
      .returning({ id: users.id });
    if (!user) throw new Error("user insert failed");

    const actor: Actor = {
      kind: "user",
      userId: user.id,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    };
    if (createdCompany) {
      await writeAudit(tx, {
        actor,
        action: "company.created",
        after: {
          name: input.companyName,
          timezone,
          state: input.state ?? null,
        },
      });
    }
    await writeAudit(tx, {
      actor,
      action: status === "active" ? "user.signed_up" : "user.signup_pending",
      entity: { type: "user", id: user.id },
      after: { email: input.email, role, status },
    });

    let session: NewSession | null = null;
    if (status === "active") {
      const s = await createSession(tx, user.id, {
        remember: input.remember,
        ...meta,
      });
      session = { ...s, userId: user.id };
    }
    return { userId: user.id, status, createdCompany, session };
  });
}

// ------------------------------------------------------------------ login / logout

export const LoginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password.").max(500),
  remember: z.coerce.boolean().default(false),
});
export type LoginInput = z.input<typeof LoginSchema>;

/** Throttle check: 5 failures per email and 20 per IP in 15 minutes (SPEC M01). */
export async function checkLoginThrottle(
  emailAddr: string,
  ip: string | null | undefined,
): Promise<void> {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS);
  const [byEmail] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.email, emailAddr),
        eq(loginAttempts.success, false),
        gt(loginAttempts.createdAt, since),
      ),
    );
  if ((byEmail?.n ?? 0) >= MAX_FAILS_PER_EMAIL) {
    throw new RateLimitedError(
      900,
      "Too many attempts. Try again in 15 minutes.",
    );
  }
  if (ip) {
    const [byIp] = await db
      .select({ n: count() })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.ip, ip),
          eq(loginAttempts.success, false),
          gt(loginAttempts.createdAt, since),
        ),
      );
    if ((byIp?.n ?? 0) >= MAX_FAILS_PER_IP) {
      throw new RateLimitedError(
        900,
        "Too many attempts. Try again in 15 minutes.",
      );
    }
  }
}

/** Verify credentials and open a session. Generic error messages only. */
export async function login(
  raw: LoginInput,
  meta: RequestMeta = {},
): Promise<NewSession> {
  const parsed = LoginSchema.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError(
      { email: [GENERIC_LOGIN_ERROR] },
      GENERIC_LOGIN_ERROR,
    );
  const input = parsed.data;
  await checkLoginThrottle(input.email, meta.ip);

  const [u] = await db
    .select({
      id: users.id,
      status: users.status,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);
  // Unknown email: still burn the same hashing time (no account enumeration by timing).
  const ok = await verifyPassword(
    input.password,
    u ? u.passwordHash : await dummyPasswordHash(),
  );

  if (!u || !ok || !u.passwordHash) {
    await db
      .insert(loginAttempts)
      .values({ email: input.email, ip: meta.ip ?? null, success: false });
    throw new ValidationError(
      { password: [GENERIC_LOGIN_ERROR] },
      GENERIC_LOGIN_ERROR,
    );
  }
  if (u.status !== "active") {
    await db
      .insert(loginAttempts)
      .values({ email: input.email, ip: meta.ip ?? null, success: false });
    const msg =
      u.status === "pending"
        ? "Your account is waiting for an admin to approve it."
        : GENERIC_LOGIN_ERROR;
    throw new ValidationError({ password: [msg] }, msg);
  }

  const newHash = needsRehash(u.passwordHash)
    ? await hashPassword(input.password)
    : null;
  return db.transaction(async (tx) => {
    await tx
      .insert(loginAttempts)
      .values({ email: input.email, ip: meta.ip ?? null, success: true });
    await tx
      .update(users)
      .set({
        lastLoginAt: new Date(),
        ...(newHash ? { passwordHash: newHash, updatedAt: new Date() } : {}),
      })
      .where(eq(users.id, u.id));
    const s = await createSession(tx, u.id, {
      remember: input.remember,
      ...meta,
    });
    return { ...s, userId: u.id };
  });
}

/** Revoke the session behind a cookie value (no-op when unknown). */
export async function logout(
  sessionId: string | null | undefined,
): Promise<void> {
  if (!sessionId) return;
  await db.transaction(async (tx) => {
    const { revokeSession } = await import("./session");
    await revokeSession(tx, sessionId);
  });
}

// ------------------------------------------------------------------ invites

export const CreateInviteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: email.optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  role: z.string().trim().min(1),
  workerType: z.enum(["w2", "1099"]).default("1099"),
});
export type CreateInviteInput = z.input<typeof CreateInviteSchema>;

/** BUILD_PLAN §2: createInvite(tx, {name, email?, phone?, role, workerType}, actor). Delivery is the caller's (B8 → enqueueMessage 'user.invite'). */
export async function createInvite(
  tx: Tx,
  raw: CreateInviteInput,
  actor: Actor,
  opts: { emit?: boolean } = {},
): Promise<{ inviteId: string; url: string; token: string; expiresAt: Date }> {
  const input = parseInput(CreateInviteSchema, raw);
  if (!input.email && !input.phone)
    throw new ValidationError({
      email: ["Enter an email or a mobile number."],
    });
  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (input.phone && !phone)
    throw new ValidationError({ phone: ["Enter a valid mobile number."] });
  const [role] = await tx
    .select({ key: roles.key })
    .from(roles)
    .where(eq(roles.key, input.role))
    .limit(1);
  if (!role) throw new ValidationError({ role: ["Unknown role."] });
  if (input.email) {
    const taken = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);
    if (taken.length)
      throw new ValidationError({
        email: ["Someone on the team already uses this email."],
      });
  }
  const { token, hash } = newTokenPair(32);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const [row] = await tx
    .insert(invites)
    .values({
      name: input.name,
      email: input.email ?? null,
      phone,
      role: input.role,
      workerType: input.workerType,
      tokenHash: hash,
      invitedBy: actor.userId ?? (await anyAdminId(tx)),
      expiresAt,
    })
    .returning({ id: invites.id });
  if (!row) throw new Error("invite insert failed");
  // Seeds pass { emit: false } (BUILD_PLAN §10.1: seeds never emit events).
  if (opts.emit !== false)
    await emit(
      tx,
      "user.invited",
      null,
      { invite_id: row.id, role: input.role },
      { actor },
    );
  await writeAudit(tx, {
    actor,
    action: "user.invited",
    after: {
      invite_id: row.id,
      name: input.name,
      email: input.email ?? null,
      role: input.role,
    },
    full: true,
  });
  return {
    inviteId: row.id,
    url: appUrl(`/invite/${token}`),
    token,
    expiresAt,
  };
}

async function anyAdminId(tx: Tx): Promise<string> {
  const [a] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.status, "active")))
    .limit(1);
  if (!a) throw new ConflictError("no_admin", "No active admin found.");
  return a.id;
}

export async function revokeInvite(
  tx: Tx,
  inviteId: string,
  actor: Actor,
): Promise<void> {
  const rows = await tx
    .update(invites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invites.id, inviteId),
        isNull(invites.acceptedAt),
        isNull(invites.revokedAt),
      ),
    )
    .returning({ id: invites.id });
  if (rows.length === 0) throw new NotFoundError("Invite");
  await writeAudit(tx, {
    actor,
    action: "invite.revoked",
    after: { invite_id: inviteId },
    full: true,
  });
}

export interface InviteView {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  baseRole: "admin" | "office" | "tech";
  workerType: string;
  expiresAt: Date;
  companyName: string;
}

/** Look up a live invite by its raw token (for /invite/[token]). */
export async function getInviteByToken(
  token: string,
): Promise<InviteView | null> {
  if (!token || token.length < 20) return null;
  const [row] = await db
    .select({
      id: invites.id,
      name: invites.name,
      email: invites.email,
      phone: invites.phone,
      role: invites.role,
      workerType: invites.workerType,
      expiresAt: invites.expiresAt,
      baseRole: roles.baseRole,
    })
    .from(invites)
    .leftJoin(roles, eq(roles.key, invites.role))
    .where(
      and(
        eq(invites.tokenHash, hashToken(token)),
        isNull(invites.acceptedAt),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return null;
  const [c] = await db.select({ name: company.name }).from(company).limit(1);
  return {
    ...row,
    baseRole: toBaseRole(row.baseRole ?? row.role),
    companyName: c?.name ?? "",
  };
}

export const AcceptInviteSchema = z.object({
  token: z.string().min(20),
  name: z.string().trim().min(1).max(120).optional(),
  email: email.optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  password: z.string().min(1, "Enter a password."),
  monitoringAck: z.coerce.boolean().default(false),
  esignConsent: z.coerce.boolean().default(false),
  remember: z.coerce.boolean().default(true),
});
export type AcceptInviteInput = z.input<typeof AcceptInviteSchema>;

/** Accept an invite: set a password, acknowledge notices, create the user + session. */
export async function acceptInvite(
  raw: AcceptInviteInput,
  meta: RequestMeta = {},
): Promise<NewSession> {
  const input = parseInput(AcceptInviteSchema, raw);
  const invite = await getInviteByToken(input.token);
  if (!invite)
    throw new ConflictError(
      "invite_invalid",
      "This invite link is invalid or has expired. Ask your admin for a new one.",
    );
  const userEmail = invite.email ?? input.email ?? null;
  const errors: Record<string, string[]> = {};
  if (!userEmail) errors.email = ["Enter your email."];
  const policy = checkPasswordPolicy(input.password, {
    email: userEmail,
    name: input.name ?? invite.name,
  });
  if (policy) errors.password = [policy];
  if (!input.esignConsent)
    errors.esignConsent = ["Please accept the electronic records consent."];
  if (invite.baseRole === "tech" && !input.monitoringAck)
    errors.monitoringAck = [
      "Please acknowledge the location monitoring notice.",
    ];
  if (Object.keys(errors).length) throw new ValidationError(errors);
  const phone = input.phone ? normalizePhone(input.phone) : invite.phone;
  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    const locked = await tx
      .select({ id: invites.id })
      .from(invites)
      .where(
        and(
          eq(invites.id, invite.id),
          isNull(invites.acceptedAt),
          isNull(invites.revokedAt),
        ),
      )
      .for("update");
    if (locked.length === 0)
      throw new ConflictError(
        "invite_invalid",
        "This invite was already used.",
      );
    const taken = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, userEmail as string))
      .limit(1);
    if (taken.length)
      throw new ValidationError({
        email: ["An account with this email already exists."],
      });
    const now = new Date();
    const [user] = await tx
      .insert(users)
      .values({
        email: userEmail as string,
        phone: phone ?? null,
        name: input.name?.trim() || invite.name,
        role: invite.role,
        status: "active",
        workerType: invite.workerType,
        passwordHash,
        esignConsentAt: now,
        monitoringNoticeAckAt: input.monitoringAck ? now : null,
        lastLoginAt: now,
      })
      .returning({ id: users.id });
    if (!user) throw new Error("user insert failed");
    await tx
      .update(invites)
      .set({ acceptedAt: now, acceptedUserId: user.id })
      .where(eq(invites.id, invite.id));
    const actor: Actor = {
      kind: "user",
      userId: user.id,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    };
    await writeAudit(tx, {
      actor,
      action: "invite.accepted",
      entity: { type: "user", id: user.id },
      after: {
        invite_id: invite.id,
        role: invite.role,
        monitoring_ack: input.monitoringAck,
        esign_consent: true,
      },
      full: true,
    });
    const s = await createSession(tx, user.id, {
      remember: input.remember,
      ...meta,
    });
    return { ...s, userId: user.id };
  });
}

// ------------------------------------------------------------------ password reset

/** Admin-generated reset link (BUILD_PLAN §2; SPEC M01 "share a link" fallback). */
export async function createPasswordResetLink(
  tx: Tx,
  userId: string,
  actor: Actor,
): Promise<{ url: string; token: string; expiresAt: Date }> {
  const [u] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) throw new NotFoundError("User");
  const { token, hash } = newTokenPair(32);
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  await tx
    .insert(passwordResets)
    .values({ userId, tokenHash: hash, expiresAt, createdBy: actor.userId });
  await writeAudit(tx, {
    actor,
    action: "user.password_reset_link",
    entity: { type: "user", id: userId },
    after: { expires_at: expiresAt },
    full: true,
  });
  return { url: appUrl(`/reset/${token}`), token, expiresAt };
}

/**
 * "Forgot password": always succeeds from the caller's view (no account enumeration).
 * Emails a 30-minute single-use link via the email adapter (console driver logs it).
 */
export async function requestPasswordReset(
  rawEmail: string,
  meta: RequestMeta = {},
  opts: { inline?: boolean } = {},
): Promise<void> {
  const parsed = email.safeParse(rawEmail);
  if (!parsed.success) return;
  const addr = parsed.data;
  await assertRateLimit({
    key: `reset:email:${addr}`,
    limit: 3,
    windowSec: 900,
  });
  if (meta.ip)
    await assertRateLimit({
      key: `reset:ip:${meta.ip}`,
      limit: 10,
      windowSec: 900,
    });
  const send = async () => {
    const [u] = await db
      .select({ id: users.id, name: users.name, status: users.status })
      .from(users)
      .where(eq(users.email, addr))
      .limit(1);
    if (!u || u.status !== "active") return;
    const link = await db.transaction((tx) =>
      createPasswordResetLink(tx, u.id, {
        ...SYSTEM_ACTOR,
        ip: meta.ip ?? null,
      }),
    );
    const [c] = await db.select({ name: company.name }).from(company).limit(1);
    const brand = c?.name ?? "your workspace";
    await sendSystemEmail({
      to: addr,
      subject: `Reset your ${brand} password`,
      text: `Hi ${u.name.split(/\s+/)[0]},\n\nUse this link to set a new password. It expires in 30 minutes and works once:\n\n${link.url}\n\nIf you didn't ask for this, you can ignore this email.`,
    });
  };
  // Lookup + email run after the response, so its timing doesn't reveal whether
  // the address has an account. Outside a request (tests, scripts) run inline.
  if (opts.inline) return send();
  try {
    const { after } = await import("next/server");
    after(() =>
      send().catch((err) => console.error("[auth] reset email failed:", err)),
    );
  } catch {
    await send();
  }
}

/** Look up a usable reset token (for /reset/[token]). */
export async function getPasswordReset(
  token: string,
): Promise<{ id: string; userId: string; expiresAt: Date } | null> {
  if (!token || token.length < 20) return null;
  const [row] = await db
    .select({
      id: passwordResets.id,
      userId: passwordResets.userId,
      expiresAt: passwordResets.expiresAt,
    })
    .from(passwordResets)
    .where(
      and(
        eq(passwordResets.tokenHash, hashToken(token)),
        isNull(passwordResets.usedAt),
        gt(passwordResets.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row ?? null;
}

export const CompleteResetSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(1, "Enter a password."),
});

/** Set a new password from a reset link, revoke every session, sign in on this device. */
export async function completePasswordReset(
  raw: z.input<typeof CompleteResetSchema>,
  meta: RequestMeta = {},
): Promise<NewSession> {
  const input = parseInput(CompleteResetSchema, raw);
  const reset = await getPasswordReset(input.token);
  if (!reset)
    throw new ConflictError(
      "reset_invalid",
      "This reset link is invalid or has expired.",
    );
  const [u] = await db
    .select({ email: users.email, name: users.name, status: users.status })
    .from(users)
    .where(eq(users.id, reset.userId))
    .limit(1);
  if (!u || u.status !== "active")
    throw new ConflictError(
      "reset_invalid",
      "This reset link is invalid or has expired.",
    );
  const policy = checkPasswordPolicy(input.password, {
    email: u.email,
    name: u.name,
  });
  if (policy) throw new ValidationError({ password: [policy] });
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const used = await tx
      .update(passwordResets)
      .set({ usedAt: new Date() })
      .where(
        and(eq(passwordResets.id, reset.id), isNull(passwordResets.usedAt)),
      )
      .returning({ id: passwordResets.id });
    if (used.length === 0)
      throw new ConflictError(
        "reset_invalid",
        "This reset link was already used.",
      );
    await tx
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, reset.userId));
    await revokeAllSessions(tx, reset.userId);
    const actor: Actor = {
      kind: "user",
      userId: reset.userId,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    };
    await writeAudit(tx, {
      actor,
      action: "user.password_reset",
      entity: { type: "user", id: reset.userId },
    });
    const s = await createSession(tx, reset.userId, {
      remember: false,
      ...meta,
    });
    return { ...s, userId: reset.userId };
  });
}

/** Change password while signed in (profile page). Other sessions are signed out. */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepSessionId: string,
  meta: RequestMeta = {},
): Promise<void> {
  const [u] = await db
    .select({ email: users.email, name: users.name, hash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u || !(await verifyPassword(currentPassword, u.hash))) {
    throw new ValidationError({
      currentPassword: ["Current password is incorrect."],
    });
  }
  const policy = checkPasswordPolicy(newPassword, {
    email: u.email,
    name: u.name,
  });
  if (policy) throw new ValidationError({ newPassword: [policy] });
  const passwordHash = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await revokeAllSessions(tx, userId, { exceptSessionId: keepSessionId });
    await writeAudit(tx, {
      actor: {
        kind: "user",
        userId,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
      action: "user.password_changed",
      entity: { type: "user", id: userId },
    });
  });
}

/** Prune old login attempts and used/expired reset tokens (system.prune). */
export async function pruneAuthTables(): Promise<void> {
  await db
    .delete(loginAttempts)
    .where(sql`${loginAttempts.createdAt} < now() - interval '30 days'`);
  await db
    .delete(passwordResets)
    .where(sql`${passwordResets.expiresAt} < now() - interval '7 days'`);
}
