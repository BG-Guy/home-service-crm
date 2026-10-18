import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { leadEvents, leadSources, leads } from "@/db/schema";
import {
  findCustomerMatch,
  findOrCreateCustomer,
} from "@/features/customers/api";
import { recordConsent } from "@/features/messaging/api";
import { listServiceTypes } from "@/features/settings/api";
import { writeActivity } from "@/lib/activity";
import { appUrl } from "@/lib/env";
import { emit } from "@/lib/events";
import { sha256Hex } from "@/lib/hash";
import { listUsersWithPerm } from "@/lib/permissions-db";
import { rateLimit } from "@/lib/ratelimit";
import { findCompany, getCompanyTimezone, getSettings } from "@/lib/settings";
import type { Actor } from "@/lib/types";
import { consentWithCompany, pageUrlFromReferer } from "../consent-text";
import { hashKey, tsSecret, verifyTurnstile } from "../keys";
import {
  applyMapping,
  type NormalizedLead,
  normalizeLeadPayload,
} from "./normalize";
import { applyPreset } from "./presets";
import { matchServiceType } from "./service-match";
import { applyTsReview, scoreLead, tsVerdict, verifyTs } from "./spam";

// Lead intake pipeline — SPEC §8.3 (normative order), shared by every endpoint:
// JSON API, form POST (plain HTML + embed.js), the hosted form and preset hooks.

export type LeadSourceRow = typeof leadSources.$inferSelect;

export type IntakeAuth =
  | { kind: "public"; source: LeadSourceRow }
  | { kind: "secret"; source: LeadSourceRow }
  | { kind: "api_key"; apiKeyId: string; source: LeadSourceRow | null }
  | { kind: "hook"; source: LeadSourceRow; preset: string }
  | { kind: "manual"; source: LeadSourceRow | null; actor: Actor };

export interface IntakeInput {
  auth: IntakeAuth;
  channel: "json" | "form" | "hook" | "manual";
  /** Parsed body (object). */
  raw: unknown;
  ip: string | null;
  userAgent: string | null;
  origin: string | null;
  referer: string | null;
  now?: Date;
}

export type IntakeOutcome =
  | {
      status: "created";
      leadId: string;
      customerId: string | null;
      spamScore: number;
    }
  | { status: "merged"; leadId: string; customerId: string | null }
  | { status: "spam"; leadId: string | null; reason: string }
  | { status: "invalid"; errors: Record<string, string[]> }
  | { status: "rate_limited"; retryAfterSec: number }
  | { status: "forbidden"; reason: string };

export interface IntakeDebug {
  lead: NormalizedLead | null;
  warnings: string[];
  missingMappings: string[];
}

const OPEN_STATUSES = ["new", "contacted", "qualified"] as const;

/** Allowed-origin check for public keys. Empty list = any origin (settings warns). */
export function originAllowed(
  allowed: readonly string[],
  origin: string | null,
  referer: string | null,
): boolean {
  if (allowed.length === 0) return true;
  let o = origin && origin !== "null" ? origin : null;
  if (!o && referer) {
    try {
      o = new URL(referer).origin;
    } catch {
      o = null;
    }
  }
  if (!o) return false;
  const host = (() => {
    try {
      return new URL(o).host.toLowerCase();
    } catch {
      return "";
    }
  })();
  return allowed.some((a) => {
    const v = a.trim().toLowerCase().replace(/\/+$/, "");
    if (!v) return false;
    if (v.startsWith("http")) return v === o?.toLowerCase();
    if (v.startsWith("*."))
      return host === v.slice(2) || host.endsWith(v.slice(1));
    return host === v || host === `www.${v}`;
  });
}

/** The hosted form (/f/<pk>) posts from our own origin: always allowed. */
export function isAppOrigin(
  origin: string | null,
  referer: string | null,
): boolean {
  let o = origin && origin !== "null" ? origin : null;
  if (!o && referer) {
    try {
      o = new URL(referer).origin;
    } catch {
      o = null;
    }
  }
  if (!o) return false;
  try {
    return new URL(appUrl()).origin === o;
  } catch {
    return false;
  }
}

/** sha256(phone|service) used to catch double submits within the dedupe window. */
export function dedupeHashOf(
  phone: string | null,
  email: string | null,
  service: string | null,
) {
  const contact = phone ?? email;
  if (!contact) return null;
  return sha256Hex(`${contact}|${(service ?? "").trim().toLowerCase()}`);
}

function truncateRaw(raw: unknown): unknown {
  try {
    const s = JSON.stringify(raw ?? null);
    return s.length > 16_000
      ? { truncated: true, preview: s.slice(0, 16_000) }
      : raw;
  } catch {
    return null;
  }
}

async function nextRoundRobin(tx: Tx): Promise<string | null> {
  const ids = (await listUsersWithPerm("leads.edit")).sort();
  if (ids.length === 0) return null;
  const [last] = await tx
    .select({ u: leads.assignedUserId })
    .from(leads)
    .where(isNotNull(leads.assignedUserId))
    .orderBy(desc(leads.createdAt))
    .limit(1);
  const i = last?.u ? ids.indexOf(last.u) : -1;
  return ids[(i + 1) % ids.length] ?? null;
}

/**
 * Run the intake pipeline. Rate limits, auth extras (origin, Google key), spam
 * checks, mapping → normalization, dedupe, customer match/create, consent, event.
 */
export async function processLead(
  input: IntakeInput,
  debug?: IntakeDebug,
  opts?: { tx?: Tx },
): Promise<IntakeOutcome> {
  const now = input.now ?? new Date();
  const source = input.auth.source;
  const settings = await getSettings();
  const ls = settings.leads;

  // 1. rate limits (per IP+key per minute; per-source daily cap)
  if (input.auth.kind !== "manual") {
    const keyId =
      input.auth.kind === "api_key"
        ? input.auth.apiKeyId
        : (source?.id ?? "none");
    const rl = await rateLimit({
      key: `lead:${input.ip ?? "noip"}:${keyId}`,
      limit: ls.rate_limit_per_minute,
      windowSec: 60,
      now,
    });
    if (!rl.ok)
      return { status: "rate_limited", retryAfterSec: rl.retryAfterSec };
    if (source) {
      const cap = await rateLimit({
        key: `leadcap:${source.id}`,
        limit: source.dailyCap || ls.daily_cap_per_source,
        windowSec: 86_400,
        now,
      });
      if (!cap.ok)
        return { status: "rate_limited", retryAfterSec: cap.retryAfterSec };
    }
  }

  // 2. origin allow-list for public keys
  let hardSpam: string | null = null;
  if (input.auth.kind === "public" && source) {
    if (
      !isAppOrigin(input.origin, input.referer) &&
      !originAllowed(source.allowedOrigins ?? [], input.origin, input.referer)
    ) {
      if (input.channel === "json")
        return { status: "forbidden", reason: "origin_not_allowed" };
      hardSpam = "origin_not_allowed";
    }
  }

  // 3–4. preset → source mapping → aliases, then normalize
  const preset =
    input.auth.kind === "hook"
      ? input.auth.preset
      : (source?.preset ?? "generic");
  const pre = applyPreset(preset, input.raw);
  if (preset === "google_ads_leadform" && source?.googleKeyHash) {
    if (!pre.googleKey || hashKey(pre.googleKey) !== source.googleKeyHash)
      return { status: "forbidden", reason: "bad_google_key" };
  }
  const mapped = applyMapping(pre.payload, input.raw, source?.mapping);
  const tz = await getCompanyTimezone();
  const {
    lead: n,
    errors,
    warnings,
  } = normalizeLeadPayload(mapped.payload, { tz });
  if (debug) {
    debug.lead = n;
    debug.warnings = warnings;
    debug.missingMappings = mapped.missing;
  }

  // 3. hard spam checks (public keys only: server-to-server callers are trusted).
  // A missing/expired `_ts` is only a review signal ("Check"), never hard spam.
  let tsReview: string | null = null;
  if (!hardSpam && n.honeypot) hardSpam = "honeypot";
  if (!hardSpam && input.auth.kind === "public" && source?.publicKey) {
    const v = tsVerdict(
      verifyTs(tsSecret(), source.publicKey, n.ts, now.getTime()),
      source.requireTs,
    );
    if (v.spam) hardSpam = v.reason;
    else tsReview = v.review ?? null;
  }
  if (!hardSpam && input.auth.kind === "public" && source?.turnstileRequired) {
    const t = await verifyTurnstile(n.turnstileToken, input.ip);
    if (t === "fail") hardSpam = "turnstile_failed";
    else if (t === "unconfigured") warnings.push("turnstile_unconfigured");
  }

  // JSON callers get field errors; forms and hooks keep the lead (never lose one).
  if (!hardSpam && input.channel === "json" && Object.keys(errors).length)
    return { status: "invalid", errors };
  if (input.channel === "manual" && !n.phone && !n.email && !n.name)
    return {
      status: "invalid",
      errors: { name: ["Enter a name, phone or email."] },
    };
  // Nobody to call back: no phone or email, not even a mistyped one (those stay in
  // "Check" with the raw text). Kept as spam so it's never lost, but it never
  // notifies the office (QA2 re-check: an empty JSON body became an "Unknown ·
  // Service not given" lead in Check and sent "New lead: service request").
  if (
    !hardSpam &&
    input.channel !== "manual" &&
    !n.phone &&
    !n.email &&
    !n.phoneRaw &&
    !errors.email
  )
    hardSpam = "no_contact";

  const isTest = n.isTest || pre.isTest;
  const sourceCost =
    pre.sourceCostCents ??
    (source?.costModel === "per_lead"
      ? (source.defaultCostCents ?? null)
      : null);
  const serviceTypes = await listServiceTypes().catch(() => []);
  const serviceTypeId = matchServiceType(n.service, serviceTypes);
  const attribution: Record<string, unknown> = { ...n.attribution };
  // Browser posts without embed.js carry no page_url: fall back to the Referer (T2-13).
  if (
    input.auth.kind === "public" &&
    !attribution.page_url &&
    !attribution.landing_url
  ) {
    const page = pageUrlFromReferer(input.referer);
    if (page) attribution.page_url = page;
  }
  // The consent wording the visitor saw, with the business name (stored as text_shown).
  const consentShown =
    n.smsConsent || n.marketingConsent
      ? (n.consentText ?? (await smsConsentShown(settings)))
      : null;
  const soft = applyTsReview(scoreLead(n), tsReview, ls.spam_review_threshold);
  const dedupeHash = dedupeHashOf(n.phone, n.email, n.service);
  const actor: Actor =
    input.auth.kind === "manual"
      ? input.auth.actor
      : { kind: "api", userId: null, ip: input.ip, userAgent: input.userAgent };
  // Custom-field values get their own column; everything else unknown stays in `extra`.
  const { custom: rawCustom, ...extraRest } = n.extra as Record<
    string,
    unknown
  >;
  const custom =
    rawCustom && typeof rawCustom === "object" && !Array.isArray(rawCustom)
      ? (rawCustom as Record<string, unknown>)
      : {};
  const extra = {
    ...extraRest,
    ...(rawCustom != null && !Object.keys(custom).length
      ? { custom: rawCustom }
      : {}),
    ...(warnings.length ? { _warnings: warnings } : {}),
    ...(Object.keys(errors).length ? { _errors: errors } : {}),
    ...(n.addressText && !n.address ? { _address_text: n.addressText } : {}),
    ...(consentShown ? { _consent_text: consentShown } : {}),
    ...(n.phoneRaw && !n.phone ? { _phone_raw: n.phoneRaw } : {}),
  };
  const rawStored = truncateRaw(input.raw);

  const write = async (tx: Tx): Promise<IntakeOutcome> => {
    const touch = async (leadId: string, why: string) => {
      const [ev] = await tx
        .insert(leadEvents)
        .values({
          leadId,
          leadSourceId: source?.id ?? null,
          kind: "touch",
          raw: { reason: why, payload: rawStored } as Record<string, unknown>,
          ip: input.ip,
          userAgent: input.userAgent,
        })
        .returning({ id: leadEvents.id });
      const [l] = await tx
        .update(leads)
        .set({
          isReturning: why === "returning" ? true : undefined,
          updatedAt: now,
        })
        .where(eq(leads.id, leadId))
        .returning({ customerId: leads.customerId, status: leads.status });
      if (l && l.status !== "spam" && !hardSpam) {
        await emit(
          tx,
          "lead.touched",
          { type: "lead", id: leadId },
          {
            lead_id: leadId,
            raw_event_id: ev?.id ?? null,
          },
          { actor },
        );
        await writeActivity(tx, {
          entity: { type: "lead", id: leadId },
          customerId: l.customerId,
          kind: "lead.touched",
          summary:
            why === "returning"
              ? "Customer reached out again about the same service"
              : "Same request submitted again",
          actorUserId: null,
        });
      }
      return {
        status: "merged" as const,
        leadId,
        customerId: l?.customerId ?? null,
      };
    };

    // 5. idempotency: (source, external_id), then the dedupe hash window
    if (n.externalId && source) {
      const [ex] = await tx
        .select({ id: leads.id })
        .from(leads)
        .where(
          and(
            eq(leads.leadSourceId, source.id),
            eq(leads.externalId, n.externalId),
          ),
        )
        .limit(1);
      if (ex) return touch(ex.id, "external_id");
    }
    if (dedupeHash && !hardSpam) {
      const since = new Date(now.getTime() - ls.dedupe_window_minutes * 60_000);
      const [dup] = await tx
        .select({ id: leads.id })
        .from(leads)
        .where(
          and(eq(leads.dedupeHash, dedupeHash), gte(leads.createdAt, since)),
        )
        .orderBy(desc(leads.createdAt))
        .limit(1);
      if (dup) return touch(dup.id, "double_submit");
    }

    // 6. customer match; an open lead for the same customer + service → touch
    let customerId: string | null = null;
    let returning = false;
    if (!hardSpam) {
      const match = await findCustomerMatch(
        { phone: n.phone, email: n.email },
        { tx },
      );
      if (match) {
        customerId = match.customerId;
        returning = true;
        const since = new Date(
          now.getTime() - ls.returning_window_days * 86_400_000,
        );
        const open = await tx
          .select({
            id: leads.id,
            st: leads.serviceTypeId,
            text: leads.serviceText,
          })
          .from(leads)
          .where(
            and(
              eq(leads.customerId, customerId),
              inArray(leads.status, [...OPEN_STATUSES]),
              gte(leads.createdAt, since),
            ),
          )
          .orderBy(desc(leads.createdAt));
        const same = open.find((o) =>
          serviceTypeId
            ? o.st === serviceTypeId
            : (o.text ?? "").trim().toLowerCase() ===
              (n.service ?? "").trim().toLowerCase(),
        );
        if (same) return touch(same.id, "returning");
      }
    }

    // 7. insert (customer created unless spam or "Check")
    const flagged = soft.score >= ls.spam_review_threshold;
    let propertyId: string | null = null;
    if (!hardSpam && !flagged && (n.phone || n.email)) {
      const fc = await findOrCreateCustomer(
        tx,
        {
          displayName: n.name,
          firstName: n.firstName,
          lastName: n.lastName,
          phone: n.phone,
          email: n.email,
          address: n.address
            ? { ...n.address, city: n.address.city, state: n.address.state }
            : null,
          leadSourceId: source?.id ?? null,
          source: source?.name ?? null,
          firstTouch:
            (attribution.first_touch as Record<string, unknown>) ??
            (Object.keys(attribution).length ? attribution : null),
          isTest,
        },
        actor,
      );
      customerId = fc.customerId;
      propertyId = fc.propertyId;
    }
    const assignedUserId =
      !hardSpam && ls.assignment === "round_robin"
        ? await nextRoundRobin(tx)
        : null;
    const [row] = await tx
      .insert(leads)
      .values({
        leadSourceId: source?.id ?? null,
        externalId: n.externalId,
        status: hardSpam ? "spam" : "new",
        customerId,
        propertyId,
        name: n.name,
        phone: n.phone,
        email: n.email,
        address: n.address
          ? {
              street: n.address.street,
              ...(n.address.unit ? { unit: n.address.unit } : {}),
              city: n.address.city,
              state: n.address.state,
              zip: n.address.zip,
            }
          : null,
        serviceTypeId,
        serviceText: n.service,
        quotedPriceCents: n.priceCents,
        preferredDate: n.preferredDate,
        preferredWindow: n.preferredWindow,
        notes: n.notes,
        attribution,
        extra,
        custom,
        sourceCostCents: sourceCost,
        smsConsent: n.smsConsent,
        marketingConsent: n.marketingConsent,
        spamScore: hardSpam ? 100 : soft.score,
        spamReason:
          hardSpam ?? (soft.reasons.length ? soft.reasons.join(",") : null),
        isReturning: returning,
        isTest,
        assignedUserId,
        dedupeHash,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: leads.id });
    if (!row) throw new Error("lead insert failed");
    const leadId = row.id;
    await tx.insert(leadEvents).values({
      leadId,
      leadSourceId: source?.id ?? null,
      kind: hardSpam ? "spam" : "received",
      raw: rawStored as Record<string, unknown>,
      outcome: hardSpam,
      ip: input.ip,
      userAgent: input.userAgent,
      actorUserId: actor.userId,
    });
    if (mapped.missing.length)
      await tx.insert(leadEvents).values({
        leadId,
        leadSourceId: source?.id ?? null,
        kind: "mapping_error",
        raw: { missing: mapped.missing },
      });
    if (hardSpam) return { status: "spam" as const, leadId, reason: hardSpam };

    // consent (never pre-checked; recorded with the text shown, page, IP and UA)
    if (customerId) {
      await recordLeadConsent(tx, {
        customerId,
        phone: n.phone,
        email: n.email,
        sms: n.smsConsent,
        marketing: n.marketingConsent,
        textShown: consentShown,
        pageUrl: (attribution.page_url ?? attribution.landing_url ?? null) as
          | string
          | null,
        ip: input.ip,
        userAgent: input.userAgent,
        source: input.channel === "manual" ? "verbal" : "web_form",
        actor,
      });
    }
    await emit(
      tx,
      "lead.created",
      { type: "lead", id: leadId },
      {
        lead_id: leadId,
        source_id: source?.id ?? null,
        customer_id: customerId,
        service: n.service,
        is_returning: returning,
        sms_consent: n.smsConsent,
      },
      { actor },
    );
    await writeActivity(tx, {
      entity: { type: "lead", id: leadId },
      customerId,
      kind: "lead.created",
      summary: `New lead${source ? ` from ${source.name}` : ""}${n.service ? ` · ${n.service}` : ""}`,
      actorUserId: actor.userId,
    });
    return {
      status: "created" as const,
      leadId,
      customerId,
      spamScore: soft.score,
    };
  };
  return opts?.tx ? write(opts.tx) : db.transaction(write);
}

/**
 * Dry run for the settings test console: preset → source mapping → aliases →
 * normalization, plus the service match and soft spam score. No writes.
 */
export async function previewLead(
  source: Pick<LeadSourceRow, "preset" | "mapping"> | null,
  raw: unknown,
  presetOverride?: string,
): Promise<{
  lead: NormalizedLead;
  errors: Record<string, string[]>;
  warnings: string[];
  missingMappings: string[];
  serviceTypeId: string | null;
  spam: { score: number; reasons: string[] };
  sourceCostCents: number | null;
}> {
  const pre = applyPreset(presetOverride ?? source?.preset ?? "generic", raw);
  const mapped = applyMapping(pre.payload, raw, source?.mapping);
  const tz = await getCompanyTimezone();
  const { lead, errors, warnings } = normalizeLeadPayload(mapped.payload, {
    tz,
  });
  const serviceTypes = await listServiceTypes().catch(() => []);
  return {
    lead,
    errors,
    warnings,
    missingMappings: mapped.missing,
    serviceTypeId: matchServiceType(lead.service, serviceTypes),
    spam: scoreLead(lead),
    sourceCostCents: pre.sourceCostCents,
  };
}

/** The SMS consent text a form showed when it didn't post `consent_text` (company named). */
export async function smsConsentShown(
  settings?: Awaited<ReturnType<typeof getSettings>>,
): Promise<string> {
  const s = settings ?? (await getSettings());
  const company = await findCompany().catch(() => null);
  return consentWithCompany(
    s.compliance.sms_consent_text,
    s.branding.app_name || company?.name || "",
  );
}

/** Record web-form/verbal consent captured with a lead (B5 recordConsent). */
export async function recordLeadConsent(
  tx: Tx,
  i: {
    customerId: string;
    phone: string | null;
    email: string | null;
    sms: boolean;
    marketing: boolean;
    textShown: string | null;
    pageUrl: string | null;
    ip: string | null;
    userAgent: string | null;
    source: "web_form" | "verbal";
    actor: Actor;
  },
): Promise<void> {
  if (!i.phone || (!i.sms && !i.marketing)) return;
  const s = await getSettings();
  if (i.sms)
    await recordConsent(
      tx,
      {
        customerId: i.customerId,
        address: i.phone,
        channel: "sms",
        purpose: "transactional",
        action: "grant",
        source: i.source,
        textShown: i.textShown ?? (await smsConsentShown(s)),
        pageUrl: i.pageUrl,
        ip: i.ip,
        userAgent: i.userAgent,
        actorUserId: i.actor.userId,
      },
      i.actor,
    );
  if (i.marketing)
    await recordConsent(
      tx,
      {
        customerId: i.customerId,
        address: i.phone,
        channel: "sms",
        purpose: "marketing",
        action: "grant",
        source: i.source,
        textShown: s.compliance.marketing_consent_text,
        pageUrl: i.pageUrl,
        ip: i.ip,
        userAgent: i.userAgent,
        actorUserId: i.actor.userId,
      },
      i.actor,
    );
}

// ------------------------------------------------------------------ key lookups

export async function sourceByPublicKey(
  pk: string,
): Promise<LeadSourceRow | null> {
  if (!/^pk_[A-Za-z0-9_]{6,80}$/.test(pk)) return null;
  const [s] = await db
    .select()
    .from(leadSources)
    .where(and(eq(leadSources.publicKey, pk), eq(leadSources.active, true)))
    .limit(1);
  return s ?? null;
}

export async function sourceBySecret(
  secret: string,
): Promise<LeadSourceRow | null> {
  const h = hashKey(secret);
  const [s] = await db
    .select()
    .from(leadSources)
    .where(and(eq(leadSources.secretHash, h), eq(leadSources.active, true)))
    .limit(1);
  return s ?? null;
}

export async function sourceByHookSecret(
  secret: string,
): Promise<LeadSourceRow | null> {
  const h = hashKey(secret);
  const [s] = await db
    .select()
    .from(leadSources)
    .where(and(eq(leadSources.hookSecretHash, h), eq(leadSources.active, true)))
    .limit(1);
  return s ?? null;
}

/** Resolve a general API key (`api_keys`, scope leads:write) and touch last_used_at. */
export async function apiKeyBySecret(
  secret: string,
): Promise<{ id: string } | null> {
  const rows = await db.execute(sql`
    update api_keys set last_used_at = now()
    where key_hash = ${hashKey(secret)} and revoked_at is null and 'leads:write' = any(scopes)
    returning id`);
  const r =
    (rows as unknown as { rows?: { id: string }[] }).rows?.[0] ??
    (Array.isArray(rows) ? (rows as { id: string }[])[0] : undefined);
  return r ? { id: r.id } : null;
}

/** Default/hinted source for general API keys: `source` field (id or name), else settings default. */
export async function sourceForApiKey(
  hint: string | null,
): Promise<LeadSourceRow | null> {
  const all = await db
    .select()
    .from(leadSources)
    .where(eq(leadSources.active, true));
  if (hint) {
    const h = hint.trim().toLowerCase();
    const hit = all.find(
      (s) => s.id === hint || s.name.trim().toLowerCase() === h || s.kind === h,
    );
    if (hit) return hit;
  }
  const s = await getSettings();
  return all.find((x) => x.id === s.leads.default_source_id) ?? null;
}
