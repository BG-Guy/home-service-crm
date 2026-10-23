// Lead status rules for the leads-flow redesign (item 4: every action has its way
// back; the "one count everywhere" fix). Pure and client-safe: the server actions
// enforce them, the lead card and box render from them, and
// tests/golden/lead-reverse.test.ts pins them.

import type { LeadBoxData, LeadMapPoint, LeadStatus } from "./contracts";

export const OPEN_STATUSES = ["new", "contacted", "qualified"] as const;
export type OpenStatus = (typeof OPEN_STATUSES)[number];

export function isOpenStatus(s: string | null | undefined): s is OpenStatus {
  return s === "new" || s === "contacted" || s === "qualified";
}

// ------------------------------------------------------------------ one count

/**
 * The one lead count (Leads tab badge, sidebar badge and the New chip): status
 * `new` and not in "Check". SQL twin: `NEW_LEADS_SQL` in queries.ts.
 */
export function countsAsNew(
  l: { status: string; spamScore: number },
  threshold: number,
): boolean {
  return l.status === "new" && l.spamScore < threshold;
}

/** "Check": an open lead whose spam score is at or over the review line. */
export function isFlagged(
  l: { status: string; spamScore: number },
  threshold: number,
): boolean {
  return isOpenStatus(l.status) && l.spamScore >= threshold;
}

// ------------------------------------------------------------------ status steps

/** The open-status steps and their way back. */
export type StatusStep =
  | "contacted"
  | "not_contacted"
  | "qualify"
  | "unqualify";

export const STATUS_STEPS: Record<
  StatusStep,
  { from: readonly OpenStatus[]; to: OpenStatus; label: string; done: string }
> = {
  contacted: {
    from: ["new"],
    to: "contacted",
    label: "Contacted",
    done: "Marked contacted",
  },
  not_contacted: {
    from: ["contacted"],
    to: "new",
    label: "Not contacted",
    done: "Back to New",
  },
  qualify: {
    from: ["new", "contacted"],
    to: "qualified",
    label: "Qualify",
    done: "Marked qualified",
  },
  unqualify: {
    from: ["qualified"],
    to: "contacted",
    label: "Unqualify",
    done: "Back to Contacted",
  },
};

/** Where a step takes a lead, or null when it doesn't apply to `status`. */
export function stepTarget(
  step: StatusStep,
  status: string,
): OpenStatus | null {
  const s = STATUS_STEPS[step];
  return (s.from as readonly string[]).includes(status) ? s.to : null;
}

// ------------------------------------------------------------------ reopen

/** One status change from lead_events (`raw.from` → `raw.to`), newest first. */
export interface StatusHop {
  from: string;
  to: string;
}

/**
 * The open status a closed lead (lost, spam, booked) returns to: follow the
 * history back from the current status to the last open one, so Reopen puts it
 * back where it was (not always Contacted). Without usable history: Contacted
 * when someone already answered, else New.
 */
export function previousOpenStatus(
  history: readonly StatusHop[],
  current: string,
  answered: boolean,
): OpenStatus {
  let want = current;
  const seen = new Set<string>();
  for (const hop of history) {
    if (hop.to !== want || hop.from === hop.to) continue;
    if (isOpenStatus(hop.from)) return hop.from;
    if (seen.has(hop.from)) break;
    seen.add(want);
    want = hop.from;
  }
  return answered ? "contacted" : "new";
}

export type ReopenRule = { ok: true } | { ok: false; reason: string };

/**
 * Whether a closed lead can be reopened now (null for open leads). Lost and spam
 * always can; a booked lead only when the job it became was cancelled.
 */
export function reopenRule(l: {
  status: string;
  jobStatus: string | null;
}): ReopenRule | null {
  if (l.status === "lost" || l.status === "spam") return { ok: true };
  if (l.status !== "booked") return null;
  if (!l.jobStatus)
    return {
      ok: false,
      reason: "It was booked without a job here, so it stays booked.",
    };
  if (l.jobStatus !== "cancelled")
    return {
      ok: false,
      reason: "Booked leads reopen once their job is cancelled.",
    };
  return { ok: true };
}

// ------------------------------------------------------------------ claim / release

/** Release (unassign) is for your own lead; someone else's is a Take over. */
export function releaseRule(
  assignedUserId: string | null,
  viewerId: string,
): "ok" | "unassigned" | "someone_else" {
  if (!assignedUserId) return "unassigned";
  return assignedUserId === viewerId ? "ok" : "someone_else";
}

// ------------------------------------------------------------------ undo

/**
 * What a status lead_event records (`lead_events.raw`): the change, and the
 * fields it overwrote so Undo can put them back.
 */
export interface StatusEventRaw {
  from: string;
  to: string;
  lost_reason?: string | null;
  prev?: {
    lost_reason?: string | null;
    spam_score?: number | null;
    spam_reason?: string | null;
    converted_job_id?: string | null;
  };
}

export interface UndoPatch {
  status: string;
  lostReason: string | null;
  spamScore?: number;
  spamReason?: string | null;
  convertedJobId?: string | null;
}

/**
 * The fields Undo writes back for one recorded change, or null when the lead has
 * moved on since (its status is no longer the change's target).
 */
export function undoPatch(
  raw: StatusEventRaw | null | undefined,
  current: { status: string },
): UndoPatch | null {
  if (!raw?.from || !raw.to || current.status !== raw.to) return null;
  const p = raw.prev ?? {};
  const out: UndoPatch = {
    status: raw.from,
    lostReason: raw.from === "lost" ? (p.lost_reason ?? null) : null,
  };
  if (p.spam_score != null) out.spamScore = p.spam_score;
  if ("spam_reason" in p) out.spamReason = p.spam_reason ?? null;
  if ("converted_job_id" in p) out.convertedJobId = p.converted_job_id ?? null;
  return out;
}

// ------------------------------------------------------------------ action groups

export type LeadActionKey =
  | "call"
  | "text"
  | "email"
  | "contacted"
  | "not_contacted"
  | "qualify"
  | "unqualify"
  | "legit"
  | "book"
  | "open_job"
  | "claim"
  | "release"
  | "take_over"
  | "edit"
  | "tags"
  | "lost"
  | "reopen"
  | "spam"
  | "not_spam";

export interface LeadActionGroup {
  key: "reach" | "forward" | "manage" | "close";
  label: string;
  actions: LeadActionKey[];
}

/**
 * The lead card's action groups (Reach / Move forward / Manage / Close): no "…"
 * menu, each button paired with its way back. Empty groups are left out.
 */
export function actionGroups(
  l: Pick<
    LeadBoxData,
    "status" | "phone" | "email" | "customerId" | "assignedUserId" | "job"
  > & { check: boolean },
  can: { edit: boolean; convert: boolean },
  viewerId: string,
): LeadActionGroup[] {
  const open = isOpenStatus(l.status);
  const reach: LeadActionKey[] = [];
  const forward: LeadActionKey[] = [];
  const manage: LeadActionKey[] = [];
  const close: LeadActionKey[] = [];
  if (can.edit) {
    if (l.phone) reach.push("call");
    if (l.phone || l.customerId) reach.push("text");
    if (l.email) reach.push("email");
  }
  if (open) {
    if (can.edit && l.check) forward.push("legit");
    else if (can.edit) {
      if (l.status === "new") forward.push("contacted");
      if (l.status === "contacted") forward.push("not_contacted");
      forward.push(l.status === "qualified" ? "unqualify" : "qualify");
    }
    if (can.convert) forward.push("book");
  } else if (l.status === "booked" && l.job) {
    forward.push("open_job");
  }
  if (can.edit) {
    if (open) {
      const r = releaseRule(l.assignedUserId, viewerId);
      manage.push(
        r === "ok" ? "release" : r === "someone_else" ? "take_over" : "claim",
      );
    }
    manage.push("edit", "tags");
    if (open) close.push("lost", "spam");
    else if (l.status === "lost") close.push("reopen", "spam");
    else if (l.status === "spam") close.push("not_spam");
    else if (l.status === "booked") close.push("reopen");
  }
  return (
    [
      { key: "reach", label: "Reach", actions: reach },
      { key: "forward", label: "Move forward", actions: forward },
      { key: "manage", label: "Manage", actions: manage },
      { key: "close", label: "Close", actions: close },
    ] as LeadActionGroup[]
  ).filter((g) => g.actions.length > 0);
}

// ------------------------------------------------------------------ display

/** "Jacob Wilson" → "JW"; a phone number → "#" (the box avatar and the map pin). */
export function initialsOf(name: string): string {
  if (/^[\d\s()+.-]+$/.test(name)) return "#";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = Array.from(parts[0] ?? "")[0] ?? "";
  const last =
    parts.length > 1
      ? (Array.from(parts[parts.length - 1] ?? "")[0] ?? "")
      : "";
  return (first + last).toUpperCase() || "?";
}

/** "Jacob Wilson" → "Jacob W."; a phone or one word stays as it is. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2 || /\d/.test(name)) return name.trim();
  const last = parts[parts.length - 1] ?? "";
  return `${parts[0]} ${Array.from(last)[0]?.toUpperCase() ?? ""}.`;
}

/** A box → its map pin (null without coordinates). */
export function toMapPoint(b: LeadBoxData): LeadMapPoint | null {
  if (b.lat == null || b.lng == null) return null;
  return {
    id: b.id,
    lat: b.lat,
    lng: b.lng,
    initials: b.initials,
    status: b.status,
    slaStart: b.slaStart,
    respondedAt: b.respondedAt,
    name: b.shortName,
    seed: b.customerId ?? b.id,
  };
}

/** Status words for toasts and the box's second line. */
export const STATUS_WORD: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  booked: "Booked",
  lost: "Lost",
  spam: "Spam",
};
