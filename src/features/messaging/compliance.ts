// Send-time compliance rules (SPEC M12, §7.2): recipient time zone, quiet hours,
// frequency caps, channel resolution for `customer_preferred` and consent gating.
// Pure functions (no DB) so they are golden-tested; the sender feeds them data.
import {
  DEFAULT_SEND_WINDOW,
  isInsideSendWindow,
  nextAllowedSendTime,
  type SendWindow,
} from "@/lib/quiet-hours";
import {
  addDaysToKey,
  dateKey,
  isValidTimeZone,
  parseDateKey,
  zonedTimeToUtc,
} from "@/lib/time";
import { timezoneForZip } from "@/lib/zip-tz";
import type { MsgChannel, Purpose } from "./contracts";

// ------------------------------------------------------------------ time zone

/** Recipient zone: property timezone → ZIP3 table → company zone (SPEC M12). */
export function recipientTimeZone(i: {
  propertyTz?: string | null;
  zip?: string | null;
  companyTz: string;
}): string {
  if (isValidTimeZone(i.propertyTz)) return i.propertyTz;
  const z = timezoneForZip(i.zip);
  if (isValidTimeZone(z)) return z;
  return i.companyTz;
}

// ------------------------------------------------------------------ quiet hours

export interface QuietDecision {
  sendAt: Date;
  deferred: boolean;
}

/**
 * Customer texts may go out only inside the window (default 08:00–20:00) in the
 * recipient's zone; otherwise defer to the next window start + 0–30 min jitter.
 * `bypass` = template `allow_outside_quiet_hours` (lead ack ≤ 5 min, on-my-way).
 */
export function applyQuietHours(
  at: Date,
  timeZone: string,
  opts: {
    window?: SendWindow;
    bypass?: boolean;
    random?: () => number;
    jitterMinutes?: number;
  } = {},
): QuietDecision {
  const window = opts.window ?? DEFAULT_SEND_WINDOW;
  if (opts.bypass || isInsideSendWindow(at, timeZone, window))
    return { sendAt: at, deferred: false };
  return {
    sendAt: nextAllowedSendTime(at, timeZone, {
      window,
      random: opts.random,
      jitterMinutes: opts.jitterMinutes,
    }),
    deferred: true,
  };
}

// ------------------------------------------------------------------ frequency caps

/** Templates exempt from the automated cap: job-live and direct-response messages. */
export const CAP_EXEMPT_TEMPLATES: readonly string[] = [
  "lead.ack",
  "lead.ack_after_hours",
  "job.on_my_way",
  "job.running_late",
  "payment.receipt",
  "job.cancelled",
  "refund.issued",
];

export interface CapInput {
  now: Date;
  purpose: Purpose;
  /** Sent by an automation (manual one-offs are never capped). */
  automated: boolean;
  templateKey: string;
  /** Template allows sending outside quiet hours (job-live). */
  live: boolean;
  /** Send times of automated, non-live customer messages in the last 24 h. */
  recentAutomated: Date[];
  /** Send times of marketing messages in the last 7 days. */
  recentMarketing: Date[];
  caps: { automated_per_24h: number; marketing_per_7d: number };
  timeZone: string;
  window?: SendWindow;
  random?: () => number;
}

export type CapDecision =
  | { ok: true }
  | { ok: false; reason: "cap_24h" | "cap_marketing_7d"; deferTo: Date };

const DAY = 86_400_000;

/** Local window start (+ jitter) on the day after `at`. */
function nextDayWindow(
  at: Date,
  tz: string,
  window: SendWindow,
  random?: () => number,
): Date {
  const key = addDaysToKey(dateKey(at, tz), 1);
  const [h, m] = window.start.split(":").map(Number);
  const opens = zonedTimeToUtc(
    { ...parseDateKey(key), hour: h ?? 8, minute: m ?? 0 },
    tz,
  );
  return nextAllowedSendTime(opens, tz, { window, random });
}

/**
 * ≤ N automated non-live messages per customer per 24 h (default 3; review requests
 * count); marketing ≤ M per 7 days (default 1). Excess is deferred to the next day
 * (marketing: until the 7-day window frees up).
 */
export function checkFrequencyCaps(i: CapInput): CapDecision {
  const window = i.window ?? DEFAULT_SEND_WINDOW;
  if (i.purpose === "internal" || !i.automated) return { ok: true };
  if (i.purpose === "marketing") {
    const since = i.now.getTime() - 7 * DAY;
    const recent = i.recentMarketing
      .filter((d) => d.getTime() > since)
      .sort((a, b) => a.getTime() - b.getTime());
    if (recent.length >= i.caps.marketing_per_7d) {
      const idx = recent.length - Math.max(1, i.caps.marketing_per_7d);
      const frees = new Date(
        (recent[Math.max(0, idx)] as Date).getTime() + 7 * DAY,
      );
      const target = new Date(
        Math.max(
          frees.getTime(),
          nextDayWindow(i.now, i.timeZone, window, i.random).getTime(),
        ),
      );
      return {
        ok: false,
        reason: "cap_marketing_7d",
        deferTo: nextAllowedSendTime(target, i.timeZone, {
          window,
          random: i.random,
        }),
      };
    }
  }
  if (i.live || CAP_EXEMPT_TEMPLATES.includes(i.templateKey))
    return { ok: true };
  const since = i.now.getTime() - DAY;
  const n = i.recentAutomated.filter((d) => d.getTime() > since).length;
  if (n >= i.caps.automated_per_24h)
    return {
      ok: false,
      reason: "cap_24h",
      deferTo: nextDayWindow(i.now, i.timeZone, window, i.random),
    };
  return { ok: true };
}

// ------------------------------------------------------------------ channels + consent

export type SmsStatusLike =
  | "unknown"
  | "transactional"
  | "marketing"
  | "opted_out";

export interface ConsentFacts {
  smsStatus: SmsStatusLike;
  doNotText: boolean;
  doNotContact: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
  /** Customer's preferred channel (customers.preferred_channel). */
  preferred?: "sms" | "whatsapp" | "email" | "call" | null;
  /** An email marketing grant exists in the consent ledger. */
  emailMarketing?: boolean;
  isTest?: boolean;
}

export interface ChannelContext {
  purpose: Purpose;
  whatsappEnabled: boolean;
  /** settings.reviews.consent_basis */
  reviewConsentBasis: "transactional" | "marketing";
}

/** May we text this customer for `purpose`? (No overrides; see `consentDecision`.) */
export function smsAllowed(f: ConsentFacts, c: ChannelContext): boolean {
  if (!f.hasPhone || f.doNotContact || f.doNotText) return false;
  if (f.smsStatus === "opted_out") return false;
  switch (c.purpose) {
    case "marketing":
      return f.smsStatus === "marketing";
    case "review":
      return c.reviewConsentBasis === "marketing"
        ? f.smsStatus === "marketing"
        : f.smsStatus === "transactional" || f.smsStatus === "marketing";
    default:
      // Transactional: express consent, or unknown with a phone number (§7.2).
      return true;
  }
}

export function emailAllowed(f: ConsentFacts, c: ChannelContext): boolean {
  if (!f.hasEmail || f.doNotContact) return false;
  if (c.purpose === "marketing")
    return f.emailMarketing === true || f.smsStatus === "marketing";
  return true;
}

export type ChannelResolution =
  | { ok: true; channel: Exclude<MsgChannel, "push" | "in_app"> }
  | { ok: false; reason: string };

/**
 * `customer_preferred` → concrete channel (§7.2): the customer's preferred channel
 * when allowed; else SMS when allowed; else email; else skip with a reason.
 */
export function resolveCustomerChannel(
  f: ConsentFacts,
  c: ChannelContext,
): ChannelResolution {
  const sms = smsAllowed(f, c);
  const email = emailAllowed(f, c);
  if (f.preferred === "email" && email) return { ok: true, channel: "email" };
  if (f.preferred === "whatsapp" && c.whatsappEnabled && sms)
    return { ok: true, channel: "whatsapp" };
  if (sms) return { ok: true, channel: "sms" };
  if (email) return { ok: true, channel: "email" };
  if (f.doNotContact) return { ok: false, reason: "do_not_contact" };
  if (f.smsStatus === "opted_out" || f.doNotText)
    return {
      ok: false,
      reason: f.hasEmail ? "opted_out" : "opted_out_no_email",
    };
  if (!f.hasPhone && !f.hasEmail) return { ok: false, reason: "no_contact" };
  return { ok: false, reason: `no_consent_${c.purpose}` };
}

export type ConsentOutcome =
  | { ok: true }
  | { ok: false; status: "suppressed_optout" | "skipped"; reason: string };

/**
 * Gate a concrete channel. `manualOverride` lets a person send a transactional one-off
 * after the explicit UI warning (never marketing or review) — do_not_contact still blocks.
 */
export function consentDecision(
  channel: MsgChannel,
  f: ConsentFacts,
  c: ChannelContext,
  manualOverride = false,
): ConsentOutcome {
  if (c.purpose === "internal") return { ok: true };
  if (f.isTest && c.purpose !== "transactional")
    return { ok: false, status: "skipped", reason: "test_customer" };
  if (f.doNotContact)
    return { ok: false, status: "suppressed_optout", reason: "do_not_contact" };
  if (channel === "sms" || channel === "whatsapp") {
    if (!f.hasPhone)
      return { ok: false, status: "skipped", reason: "no_phone" };
    if (smsAllowed(f, c)) return { ok: true };
    const overridable = manualOverride && c.purpose === "transactional";
    if (overridable) return { ok: true };
    if (f.smsStatus === "opted_out" || f.doNotText)
      return {
        ok: false,
        status: "suppressed_optout",
        reason: f.doNotText ? "do_not_text" : "opted_out",
      };
    return { ok: false, status: "skipped", reason: `no_consent_${c.purpose}` };
  }
  if (channel === "email") {
    if (!f.hasEmail)
      return { ok: false, status: "skipped", reason: "no_email" };
    if (emailAllowed(f, c)) return { ok: true };
    return { ok: false, status: "skipped", reason: `no_consent_${c.purpose}` };
  }
  return { ok: true };
}
