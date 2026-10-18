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

/** Deep link for an activity row's entity (Appendix A routes only). */
export function activityHref(
  entityType: string,
  entityId: string,
  ctx: { jobId?: string | null; customerId?: string | null } = {},
): string | undefined {
  switch (entityType) {
    case "job":
      return `/jobs/${entityId}`;
    case "customer":
      return `/customers/${entityId}`;
    case "lead":
      return `/leads/${entityId}`;
    case "estimate":
      return `/estimates/${entityId}`;
    case "invoice":
      return `/invoices/${entityId}`;
    case "vehicle":
      return `/vehicles/${entityId}`;
    case "tool":
      return `/tools/${entityId}`;
    case "dispute":
      return `/disputes/${entityId}`;
    case "message":
    case "scheduled_message":
      return ctx.customerId ? `/messages/${ctx.customerId}` : undefined;
    case "review_request":
      return ctx.jobId ? `/jobs/${ctx.jobId}` : undefined;
    default:
      return ctx.jobId ? `/jobs/${ctx.jobId}` : undefined;
  }
}
