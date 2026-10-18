// Activity timeline presentation rules (BUILD_PLAN Appendix C, SPEC M22). Pure and
// client-safe: kind → filter bucket, tone and icon key; entity → deep link.
import type { TimelineFilter } from "./contracts";

export const TIMELINE_PREFIXES: Record<
  Exclude<TimelineFilter, "all">,
  string[]
> = {
  messages: ["message.", "consent.", "call.", "review."],
  jobs: ["job.", "estimate.", "change_order.", "lead.", "photo.", "signature."],
  money: [
    "invoice.",
    "payment.",
    "refund.",
    "deposit.",
    "dispute.",
    "efw.",
    "credit_note.",
  ],
  notes: ["note."],
};

/** Kinds never shown in "All" (privacy audit rows). */
export const HIDDEN_KINDS = ["customer.viewed"];

export const FILTER_LABELS: Record<TimelineFilter, string> = {
  all: "All",
  messages: "Messages",
  jobs: "Jobs",
  money: "Money",
  notes: "Notes",
};

export function matchesFilter(kind: string, f: TimelineFilter): boolean {
  if (f === "all") return !HIDDEN_KINDS.includes(kind);
  return TIMELINE_PREFIXES[f].some((p) => kind.startsWith(p));
}

export type ActivityIcon =
  | "message"
  | "consent"
  | "call"
  | "star"
  | "job"
  | "check"
  | "x"
  | "doc"
  | "lead"
  | "camera"
  | "pen"
  | "money"
  | "alert"
  | "note"
  | "truck"
  | "wrench"
  | "user"
  | "dot";

export type ActivityTone =
  | "accent"
  | "blue"
  | "green"
  | "red"
  | "orange"
  | "purple"
  | "teal"
  | "indigo"
  | "gray";

/** Icon + tone per activity kind (first match wins). */
export function kindVisual(kind: string): {
  icon: ActivityIcon;
  tone: ActivityTone;
} {
  if (kind === "message.failed") return { icon: "alert", tone: "red" };
  if (kind.startsWith("message.optout"))
    return { icon: "alert", tone: "orange" };
  if (kind.startsWith("message.")) return { icon: "message", tone: "blue" };
  if (kind.startsWith("consent.")) return { icon: "consent", tone: "indigo" };
  if (kind.startsWith("call.")) return { icon: "call", tone: "green" };
  if (kind.startsWith("review.")) return { icon: "star", tone: "orange" };
  if (kind === "job.completed" || kind === "job.closed")
    return { icon: "check", tone: "green" };
  if (kind === "job.cancelled") return { icon: "x", tone: "red" };
  if (kind.startsWith("job.en_route") || kind.startsWith("job.arrived"))
    return { icon: "truck", tone: "teal" };
  if (kind.startsWith("job.")) return { icon: "job", tone: "accent" };
  if (kind.startsWith("estimate.") || kind.startsWith("change_order."))
    return { icon: "doc", tone: "purple" };
  if (kind.startsWith("lead.")) return { icon: "lead", tone: "teal" };
  if (kind.startsWith("photo.")) return { icon: "camera", tone: "gray" };
  if (kind.startsWith("signature.")) return { icon: "pen", tone: "indigo" };
  if (kind.startsWith("dispute.") || kind.startsWith("efw."))
    return { icon: "alert", tone: "red" };
  if (
    kind.startsWith("invoice.") ||
    kind.startsWith("payment.") ||
    kind.startsWith("refund.") ||
    kind.startsWith("deposit.") ||
    kind.startsWith("credit_note.")
  )
    return { icon: "money", tone: "green" };
  if (kind.startsWith("note.")) return { icon: "note", tone: "gray" };
  if (kind.startsWith("vehicle.")) return { icon: "truck", tone: "orange" };
  if (kind.startsWith("tool.")) return { icon: "wrench", tone: "orange" };
  if (kind.startsWith("user.") || kind.startsWith("permission."))
    return { icon: "user", tone: "gray" };
  return { icon: "dot", tone: "gray" };
}

/** What an activity row knows besides its entity, and who is looking. */
export interface ActivityLinkContext {
  jobId?: string | null;
  customerId?: string | null;
  /** The vehicle a log, issue or document row belongs to (row data). */
  vehicleId?: string | null;
  /** The viewer may open teammates' profiles (`users.manage`). */
  canOpenTeam?: boolean;
  /** The viewer: their own profile always opens. */
  viewerId?: string | null;
}

/** Vehicle sub-records (logs, issues, documents, trips) live on the vehicle's page. */
const VEHICLE_RECORDS = new Set([
  "vehicle_issue",
  "document",
  "odometer",
  "fuel",
  "service",
  "inspection",
  "trip",
]);

/**
 * Deep link for an activity row's entity (Appendix A routes; the same places as
 * `entityUrl` in automations/context.ts). `undefined` when the row has nowhere
 * useful to go, or nowhere the viewer may go (a teammate without users.manage).
 */
export function activityHref(
  entityType: string,
  entityId: string,
  ctx: ActivityLinkContext = {},
): string | undefined {
  const job = ctx.jobId ? `/jobs/${ctx.jobId}` : undefined;
  if (VEHICLE_RECORDS.has(entityType))
    return ctx.vehicleId ? `/vehicles/${ctx.vehicleId}` : job;
  switch (entityType) {
    case "job":
      return `/jobs/${entityId}`;
    case "customer":
      return `/customers/${entityId}`;
    case "lead":
      return `/leads/${entityId}`;
    case "estimate":
      return `/estimates/${entityId}`;
    case "change_order":
      return `/estimates/co/${entityId}`;
    case "invoice":
      return `/invoices/${entityId}`;
    case "payment":
    case "refund":
    case "deposit_request":
      // Money on a job is on its invoice tab.
      return job ? `${job}?tab=invoice` : undefined;
    case "part_purchase":
      // A job's receipts are on its parts tab (approvals are admin-only).
      return job ? `${job}?tab=parts` : undefined;
    case "vehicle":
      return `/vehicles/${entityId}`;
    case "tool":
      return `/tools/${entityId}`;
    case "tool_audit":
      return `/tools/audits/${entityId}`;
    case "dispute":
      return `/disputes/${entityId}`;
    case "settlement":
      return `/pay/statements/${entityId}`;
    case "task":
      return "/tasks";
    case "user":
      return ctx.canOpenTeam || (!!ctx.viewerId && entityId === ctx.viewerId)
        ? `/team/${entityId}`
        : job;
    case "message":
    case "scheduled_message":
      return ctx.customerId ? `/messages/${ctx.customerId}` : undefined;
    case "review_request":
      return job;
    default:
      return job;
  }
}
