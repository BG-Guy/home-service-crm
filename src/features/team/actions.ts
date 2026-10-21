"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import { invites, roles, users } from "@/db/schema";
import {
  createInvite,
  createPasswordResetLink,
  revokeAllSessions,
  revokeInvite,
} from "@/features/auth/api";
import { enqueueMessage } from "@/features/messaging/api";
import { deletePushSubscriptions } from "@/features/notify/api";
import { action, zf } from "@/lib/action";
import { normalizeHex } from "@/lib/branding";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { toBaseRole } from "@/lib/permissions";
import { normalizePhone } from "@/lib/phone";
import { getCompanyTimezone } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import type { Actor, SessionUser } from "@/lib/types";
import { lastAdminBlock, memberProfileDateErrors } from "./rules";

// Team mutations (SPEC M01/M02; BUILD_PLAN §9 B8). Every write goes through action():
// perm → zod → one transaction (write + audit + events + activity) → revalidate.
// Messages go out only through B5 enqueueMessage (template `user.invite` /
// `user.password_reset`, audience `address`).

const TEAM = "/team";

const optText = (max = 200) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(max).nullable().optional(),
  );

async function roleRow(tx: Tx, key: string) {
  const [r] = await tx
    .select({ key: roles.key, name: roles.name, baseRole: roles.baseRole })
    .from(roles)
    .where(eq(roles.key, key))
    .limit(1);
  if (!r) throw new ValidationError({ role: ["Unknown role."] });
  return { ...r, base: toBaseRole(r.baseRole) };
}

async function activeAdminCount(tx: Tx, excludingUserId?: string) {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .innerJoin(roles, eq(roles.key, users.role))
    .where(
      and(
        eq(users.status, "active"),
        eq(roles.baseRole, "admin"),
        excludingUserId ? ne(users.id, excludingUserId) : undefined,
      ),
    );
  return r?.n ?? 0;
}

async function loadUser(tx: Tx, id: string) {
  const [u] = await tx
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: users.role,
      status: users.status,
      workerType: users.workerType,
      birthDate: users.birthDate,
      baseRole: roles.baseRole,
    })
    .from(users)
    .leftJoin(roles, eq(roles.key, users.role))
    .where(eq(users.id, id))
    .limit(1);
  if (!u) throw new NotFoundError("Team member");
  return { ...u, base: toBaseRole(u.baseRole ?? u.role) };
}

/* ------------------------------------------------------------------ invites */

const inviteInput = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(120),
  email: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.email("Enter a valid email.").toLowerCase().nullable().optional(),
  ),
  phone: optText(40),
  role: z.string().min(1, "Pick a role.").max(40),
  workerType: z.enum(["w2", "1099"]).default("1099"),
  sendEmail: zf.checkbox().optional(),
  sendSms: zf.checkbox().optional(),
});

interface InviteResult {
  inviteId: string;
  url: string;
  expiresAt: string;
  emailed: boolean;
  texted: boolean;
  smsHref: string | null;
}

async function deliverInvite(
  tx: Tx,
  a: {
    inviteId: string;
    url: string;
    name: string;
    email: string | null;
    phone: string | null;
    sendEmail: boolean;
    sendSms: boolean;
  },
  user: SessionUser,
  actor: Actor,
): Promise<{ emailed: boolean; texted: boolean }> {
  const vars = {
    "invite.name": a.name.split(/\s+/)[0] ?? a.name,
    "invite.by": user.name,
    "invite.url": a.url,
  };
  let emailed = false;
  let texted = false;
  if (a.email && a.sendEmail) {
    await enqueueMessage(
      tx,
      {
        templateKey: "user.invite",
        channel: "email",
        purpose: "internal",
        audience: { type: "address", to: a.email, name: a.name },
        vars,
        dedupeKey: `invite:${a.inviteId}:email`,
      },
      actor,
    );
    emailed = true;
  }
  if (a.phone && a.sendSms) {
    // Link mode: lands in the inviter's outbox as a tap-to-send card.
    await enqueueMessage(
      tx,
      {
        templateKey: "user.invite",
        channel: "sms",
        purpose: "internal",
        audience: { type: "address", to: a.phone, name: a.name },
        vars,
        dedupeKey: `invite:${a.inviteId}:sms`,
        outboxAssigneeUserId: user.id,
      },
      actor,
    );
    texted = true;
  }
  return { emailed, texted };
}

function smsHref(phone: string | null, url: string, company = "our team") {
  if (!phone) return null;
  const body = `You're invited to join ${company}'s app. Set up your account: ${url}`;
  // `?&body=` is understood by both iOS and Android messaging apps.
  return `sms:${phone}?&body=${encodeURIComponent(body)}`;
}

export const inviteUserAction = action({
  name: "team.invite",
  perm: "users.invite",
  input: inviteInput,
  async run({ input, tx, user, actor, activity }): Promise<InviteResult> {
    const role = await roleRow(tx, input.role);
    if (role.base === "admin" && !user.perms.has("users.manage"))
      throw new ValidationError({
        role: ["Only people who manage users can invite admins."],
      });
    const phone = input.phone ? normalizePhone(input.phone) : null;
    if (input.phone && !phone)
      throw new ValidationError({ phone: ["Enter a valid mobile number."] });
    if (!input.email && !phone)
      throw new ValidationError({
        email: ["Enter an email or a mobile number."],
      });
    const [dupe] = await tx
      .select({ id: invites.id })
      .from(invites)
      .where(
        and(
          sql`lower(${invites.email}) = ${input.email ?? "\u0000"}`,
          sql`${invites.acceptedAt} is null and ${invites.revokedAt} is null and ${invites.expiresAt} > now()`,
        ),
      )
      .limit(1);
    if (dupe)
      throw new ValidationError({
        email: ["There's already a pending invite for this email."],
      });
    const inv = await createInvite(
      tx,
      {
        name: input.name,
        email: input.email ?? null,
        phone,
        role: input.role,
        workerType: input.workerType,
      },
      actor,
    );
    const sent = await deliverInvite(
      tx,
      {
        inviteId: inv.inviteId,
        url: inv.url,
        name: input.name,
        email: input.email ?? null,
        phone,
        sendEmail: input.sendEmail ?? !!input.email,
        sendSms: input.sendSms ?? false,
      },
      user,
      actor,
    );
    await activity({
      entity: { type: "user", id: user.id },
      kind: "user.invited",
      summary: `Invited ${input.name} as ${role.name}`,
      data: { invite_id: inv.inviteId, role: input.role },
    });
    return {
      inviteId: inv.inviteId,
      url: inv.url,
      expiresAt: inv.expiresAt.toISOString(),
      ...sent,
      smsHref: smsHref(phone, inv.url),
    };
  },
  revalidate: () => [TEAM, "/today"],
});

/** Revoke the old token and send a fresh 7-day link with the same details. */
export const resendInviteAction = action({
  name: "team.invite_resend",
  perm: "users.invite",
  input: z.object({ inviteId: z.uuid() }),
  async run({ input, tx, user, actor }): Promise<InviteResult> {
    const [old] = await tx
      .select()
      .from(invites)
      .where(eq(invites.id, input.inviteId))
      .limit(1);
    if (!old || old.acceptedAt || old.revokedAt)
      throw new NotFoundError("Invite");
    await revokeInvite(tx, old.id, actor);
    const inv = await createInvite(
      tx,
      {
        name: old.name,
        email: old.email,
        phone: old.phone,
        role: old.role,
        workerType: old.workerType === "w2" ? "w2" : "1099",
      },
      actor,
    );
    const sent = await deliverInvite(
      tx,
      {
        inviteId: inv.inviteId,
        url: inv.url,
        name: old.name,
        email: old.email,
        phone: old.phone,
        sendEmail: !!old.email,
        sendSms: !old.email && !!old.phone,
      },
      user,
      actor,
    );
    return {
      inviteId: inv.inviteId,
      url: inv.url,
      expiresAt: inv.expiresAt.toISOString(),
      ...sent,
      smsHref: smsHref(old.phone, inv.url),
    };
  },
  revalidate: () => [TEAM],
});

export const revokeInviteAction = action({
  name: "team.invite_revoke",
  perm: "users.invite",
  input: z.object({ inviteId: z.uuid() }),
  async run({ input, tx, actor }) {
    await revokeInvite(tx, input.inviteId, actor);
  },
  revalidate: () => [TEAM],
});

/* ------------------------------------------------------------------ profile (admin) */

const licenseInput = z.object({
  state: z.string().trim().toUpperCase().max(2).default(""),
  trade: z.string().trim().max(60).default(""),
  number: z.string().trim().max(60).default(""),
  expires_on: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.iso.date().optional(),
  ),
});

function indexed<T extends z.ZodType>(item: T) {
  return z.preprocess((v) => {
    if (v === undefined || v === null || v === "") return [];
    if (Array.isArray(v)) return v;
    if (typeof v === "object")
      return Object.entries(v as Record<string, unknown>)
        .filter(([k]) => /^\d+$/.test(k))
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, x]) => x);
    return [v];
  }, z.array(item));
}

export const updateMemberAction = action({
  name: "team.update",
  perm: "users.manage",
  input: z.object({
    userId: z.uuid(),
    name: z.string().trim().min(1, "Enter a name.").max(120),
    email: z.email("Enter a valid email.").toLowerCase(),
    phone: optText(40),
    color: optText(9),
    hireDate: z.preprocess(
      (v) => (v === "" ? null : v),
      z.iso.date().nullable().optional(),
    ),
    experienceYears: z.preprocess(
      (v) => (v === "" || v == null ? null : Number(v)),
      z
        .number("Enter 0 to 60 years.")
        .int("Enter whole years.")
        .min(0, "Enter 0 to 60 years.")
        .max(60, "Enter 0 to 60 years.")
        .nullable()
        .optional(),
    ),
    birthDate: z.preprocess(
      (v) => (v === "" ? null : v),
      z.iso.date("Enter a valid date.").nullable().optional(),
    ),
    workerType: z.enum(["w2", "1099"]),
    usesCompanyTools: zf.checkbox(),
    usesCompanyVehicle: zf.checkbox(),
    serviceZips: z.string().max(4000).default(""),
    skills: zf.array(z.uuid()),
    licenses: indexed(licenseInput),
    home: z
      .object({
        street: optText(200),
        unit: optText(40),
        city: optText(80),
        state: optText(2),
        zip: optText(10),
      })
      .optional(),
  }),
  async run({ input, tx, audit, activity }) {
    const before = await loadUser(tx, input.userId);
    const dateErrors = memberProfileDateErrors(
      input,
      dateKey(new Date(), await getCompanyTimezone()),
    );
    if (Object.keys(dateErrors).length) throw new ValidationError(dateErrors);
    const [clash] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, input.email), ne(users.id, input.userId)))
      .limit(1);
    if (clash)
      throw new ValidationError({
        email: ["Another team member uses this email."],
      });
    const phone = input.phone ? normalizePhone(input.phone) : null;
    if (input.phone && !phone)
      throw new ValidationError({ phone: ["Enter a valid phone number."] });
    const color = input.color ? normalizeHex(input.color) : null;
    if (input.color && !color)
      throw new ValidationError({ color: ["Use a hex color like #2F7CF6."] });
    const zips = [
      ...new Set(
        input.serviceZips
          .split(/[\s,;]+/)
          .map((z) => z.trim())
          .filter(Boolean),
      ),
    ];
    const bad = zips.filter((z) => !/^\d{5}$/.test(z));
    if (bad.length)
      throw new ValidationError({
        serviceZips: [`Not a 5-digit ZIP: ${bad.slice(0, 3).join(", ")}`],
      });
    const licenses = input.licenses
      .filter((l) => l.number)
      .map((l) => ({
        state: l.state,
        trade: l.trade,
        number: l.number,
        ...(l.expires_on ? { expires_on: l.expires_on } : {}),
      }));
    const h = input.home;
    const homeBase =
      h && (h.street || h.city || h.zip)
        ? {
            ...(h.street ? { street: h.street } : {}),
            ...(h.unit ? { unit: h.unit } : {}),
            ...(h.city ? { city: h.city } : {}),
            ...(h.state ? { state: h.state.toUpperCase() } : {}),
            ...(h.zip ? { zip: h.zip } : {}),
          }
        : null;
    const next = {
      name: input.name,
      email: input.email,
      phone,
      color,
      hireDate: input.hireDate ?? null,
      experienceYears: input.experienceYears ?? null,
      workerType: input.workerType,
      usesCompanyTools: input.usesCompanyTools,
      usesCompanyVehicle: input.usesCompanyVehicle,
      serviceZips: zips,
      skills: input.skills,
      licenseNumbers: licenses,
      homeBase,
    };
    // Date of birth is written but kept out of the (immutable) audit payload: the
    // log only records that it changed.
    const birthDate = input.birthDate ?? null;
    await tx
      .update(users)
      .set({ ...next, birthDate, updatedAt: new Date() })
      .where(eq(users.id, input.userId));
    const entity = { type: "user" as const, id: input.userId };
    await audit({
      action: "user.profile_updated",
      entity,
      before: {
        name: before.name,
        email: before.email,
        phone: before.phone,
        worker_type: before.workerType,
      },
      after: {
        ...next,
        birth_date_changed: (before.birthDate ?? null) !== birthDate,
      },
    });
    if (before.workerType !== input.workerType) {
      await audit({
        action: "user.worker_type_changed",
        entity,
        before: { worker_type: before.workerType },
        after: { worker_type: input.workerType },
        full: true,
      });
      await activity({
        entity,
        kind: "user.worker_type_changed",
        summary: `Worker type changed to ${input.workerType === "w2" ? "W-2" : "1099"}`,
      });
    }
  },
  revalidate: ({ input }) => [TEAM, `${TEAM}/${input.userId}`],
});

export const setMemberAvatarAction = action({
  name: "team.avatar",
  perm: "users.manage",
  input: z.object({ userId: z.uuid(), mediaId: z.uuid().nullable() }),
  async run({ input, tx, audit }) {
    await tx
      .update(users)
      .set({ avatarMediaId: input.mediaId, updatedAt: new Date() })
      .where(eq(users.id, input.userId));
    await audit({
      action: "user.avatar_changed",
      entity: { type: "user", id: input.userId },
      after: { media_id: input.mediaId },
      full: true,
    });
  },
  revalidate: ({ input }) => [TEAM, `${TEAM}/${input.userId}`],
});

/* ------------------------------------------------------------------ role */

export const changeRoleAction = action({
  name: "team.role",
  perm: "users.manage",
  input: z.object({ userId: z.uuid(), role: z.string().min(1).max(40) }),
  async run({ input, tx, user, audit, emit, activity }) {
    const target = await loadUser(tx, input.userId);
    if (target.role === input.role) return;
    const role = await roleRow(tx, input.role);
    if (role.base === "admin" && !user.perms.has("settings.permissions"))
      throw new ConflictError(
        "admin_only",
        "Only admins who manage permissions can make someone an admin.",
      );
    if (target.status === "active" && target.base === "admin") {
      const block = lastAdminBlock({
        targetIsActiveAdmin: true,
        otherActiveAdmins: await activeAdminCount(tx, target.id),
        nextIsAdmin: role.base === "admin",
      });
      if (block) throw new ConflictError("last_admin", block);
    }
    await tx
      .update(users)
      .set({ role: input.role, updatedAt: new Date() })
      .where(eq(users.id, input.userId));
    const entity = { type: "user" as const, id: input.userId };
    await audit({
      action: "user.role_changed",
      entity,
      before: { role: target.role },
      after: { role: input.role },
      full: true,
    });
    await emit("permission.changed", entity, {
      role: input.role,
      user_id: input.userId,
      perm: "*",
    });
    await activity({
      entity,
      kind: "user.role_changed",
      summary: `Role changed to ${role.name}`,
    });
  },
  revalidate: ({ input }) => [
    TEAM,
    `${TEAM}/${input.userId}`,
    "/settings/permissions",
  ],
});

/* ------------------------------------------------------------------ status */

export const deactivateUserAction = action({
  name: "team.deactivate",
  perm: "users.manage",
  input: z.object({ userId: z.uuid() }),
  async run({ input, tx, user, audit, emit, activity }) {
    if (input.userId === user.id)
      throw new ConflictError("self", "You can't deactivate yourself.");
    const target = await loadUser(tx, input.userId);
    if (target.status === "deactivated") return { sessions: 0, devices: 0 };
    const block = lastAdminBlock({
      targetIsActiveAdmin:
        target.status === "active" && target.base === "admin",
      otherActiveAdmins: await activeAdminCount(tx, target.id),
      nextIsAdmin: false,
    });
    if (block) throw new ConflictError("last_admin", block);
    const now = new Date();
    await tx
      .update(users)
      .set({ status: "deactivated", deactivatedAt: now, updatedAt: now })
      .where(eq(users.id, input.userId));
    // SPEC M01 offboarding: sessions and push devices go immediately, in this tx.
    const sessions = await revokeAllSessions(tx, input.userId);
    const devices = await deletePushSubscriptions(tx, input.userId);
    const entity = { type: "user" as const, id: input.userId };
    await emit("user.deactivated", entity, { user_id: input.userId });
    await audit({
      action: "user.deactivated",
      entity,
      before: { status: target.status },
      after: { status: "deactivated", sessions, devices },
      full: true,
    });
    await activity({
      entity,
      kind: "user.deactivated",
      summary: `${target.name} was deactivated`,
    });
    return { sessions, devices };
  },
  revalidate: ({ input }) => [TEAM, `${TEAM}/${input.userId}`],
});

export const reactivateUserAction = action({
  name: "team.reactivate",
  perm: "users.manage",
  input: z.object({ userId: z.uuid() }),
  async run({ input, tx, audit, activity }) {
    const target = await loadUser(tx, input.userId);
    // Deactivated → active, or approve an open-signup account waiting in `pending`.
    if (target.status !== "deactivated" && target.status !== "pending") return;
    const approving = target.status === "pending";
    await tx
      .update(users)
      .set({ status: "active", deactivatedAt: null, updatedAt: new Date() })
      .where(eq(users.id, input.userId));
    const entity = { type: "user" as const, id: input.userId };
    await audit({
      action: approving ? "user.approved" : "user.reactivated",
      entity,
      before: { status: target.status },
      after: { status: "active" },
      full: true,
    });
    await activity({
      entity,
      kind: approving ? "user.approved" : "user.reactivated",
      summary: approving
        ? `${target.name} was approved`
        : `${target.name} was reactivated`,
    });
  },
  revalidate: ({ input }) => [TEAM, `${TEAM}/${input.userId}`],
});

/* ------------------------------------------------------------------ password reset */

/** 30-minute single-use link. Emails it when asked; the admin can also copy and share it. */
export const createResetLinkAction = action({
  name: "team.reset_link",
  perm: "users.manage",
  input: z.object({ userId: z.uuid(), email: z.boolean().default(false) }),
  async run({ input, tx, actor }) {
    const target = await loadUser(tx, input.userId);
    if (target.status === "deactivated")
      throw new ConflictError(
        "deactivated",
        "Reactivate this person before resetting their password.",
      );
    const link = await createPasswordResetLink(tx, input.userId, actor);
    if (input.email && target.email) {
      await enqueueMessage(
        tx,
        {
          templateKey: "user.password_reset",
          channel: "email",
          purpose: "internal",
          audience: { type: "address", to: target.email, name: target.name },
          vars: { "reset.url": link.url },
          entity: { type: "user", id: target.id },
        },
        actor,
      );
    }
    return {
      url: link.url,
      expiresAt: link.expiresAt.toISOString(),
      emailed: input.email && !!target.email,
    };
  },
});
