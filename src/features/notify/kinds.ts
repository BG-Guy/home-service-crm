import {
  BadgeDollarSign,
  Banknote,
  Bell,
  Briefcase,
  CalendarClock,
  CalendarX,
  Car,
  CircleCheck,
  CircleHelp,
  ClipboardCheck,
  ClipboardList,
  Clock,
  CreditCard,
  Eye,
  FileCheck,
  FileWarning,
  Flag,
  Hammer,
  HandCoins,
  Hourglass,
  Landmark,
  ListChecks,
  ListTodo,
  type LucideIcon,
  MessageCircle,
  MessageCircleWarning,
  Newspaper,
  OctagonAlert,
  PenLine,
  Play,
  Receipt,
  Repeat,
  Scale,
  Send,
  ShieldAlert,
  Star,
  Sun,
  Timer,
  TriangleAlert,
  Undo2,
  UserPlus,
  Wallet,
  Wrench,
} from "lucide-react";
import type { Tone } from "@/ui/tone";

// How each notification type looks in the notification center (client-safe data):
// an icon with its color, and the category its filter chip groups it under. Types
// not listed fall back to the bell (gray, Other).

export type NotifyCategory =
  | "leads"
  | "jobs"
  | "estimates"
  | "messages"
  | "money"
  | "approvals"
  | "team"
  | "fleet"
  | "other";

export const CATEGORY_LABEL: Record<NotifyCategory, string> = {
  leads: "Leads",
  jobs: "Jobs",
  estimates: "Estimates",
  messages: "Texts",
  money: "Money",
  approvals: "Approvals",
  team: "Team & pay",
  fleet: "Fleet & tools",
  other: "Other",
};

export const CATEGORY_ORDER: readonly NotifyCategory[] = [
  "leads",
  "jobs",
  "estimates",
  "messages",
  "money",
  "approvals",
  "team",
  "fleet",
  "other",
];

export interface NotifyKind {
  icon: LucideIcon;
  tone: Tone;
  category: NotifyCategory;
  /** The kind's short name in the peek ("New lead"). */
  label: string;
}

const K = (
  icon: LucideIcon,
  tone: Tone,
  category: NotifyCategory,
  label: string,
): NotifyKind => ({ icon, tone, category, label });

const KINDS: Record<string, NotifyKind> = {
  "staff.new_lead": K(UserPlus, "blue", "leads", "New lead"),
  "staff.lead_sla": K(Timer, "orange", "leads", "Lead waiting"),
  "staff.lead_touched": K(Repeat, "indigo", "leads", "Lead came back"),
  "staff.job_assigned": K(Briefcase, "blue", "jobs", "Job assigned"),
  "staff.job_changed": K(CalendarClock, "indigo", "jobs", "Job changed"),
  "staff.daily_agenda": K(Sun, "yellow", "jobs", "Morning agenda"),
  "staff.unconfirmed": K(CalendarX, "orange", "jobs", "Unconfirmed job"),
  "staff.late_prompt": K(Clock, "orange", "jobs", "Running late"),
  "staff.reschedule_requested": K(
    CalendarClock,
    "purple",
    "jobs",
    "Reschedule request",
  ),
  "staff.estimate_viewed": K(Eye, "teal", "estimates", "Estimate viewed"),
  "staff.estimate_approved": K(
    FileCheck,
    "green",
    "estimates",
    "Estimate approved",
  ),
  "staff.message_received": K(MessageCircle, "green", "messages", "New text"),
  "staff.outbox_ready": K(Send, "blue", "messages", "Texts ready to send"),
  "staff.optout_review": K(
    MessageCircleWarning,
    "orange",
    "messages",
    "Possible opt-out",
  ),
  "staff.message_failed": K(TriangleAlert, "red", "messages", "Text failed"),
  "staff.low_rating": K(Star, "red", "messages", "Low rating"),
  "staff.deposit_paid": K(BadgeDollarSign, "green", "money", "Deposit paid"),
  "staff.payment_failed": K(CreditCard, "red", "money", "Payment failed"),
  "staff.manual_unverified": K(
    CircleHelp,
    "orange",
    "money",
    "Unverified payment",
  ),
  "staff.receipt_flagged": K(Flag, "orange", "money", "Receipt flagged"),
  "staff.refund_due": K(Undo2, "purple", "money", "Refund due"),
  "staff.hold_expiring": K(Hourglass, "orange", "money", "Card hold expiring"),
  "staff.dispute": K(ShieldAlert, "red", "money", "Chargeback"),
  "staff.efw": K(OctagonAlert, "red", "money", "Fraud warning"),
  "staff.approval_needed": K(
    ClipboardCheck,
    "indigo",
    "approvals",
    "Approval waiting",
  ),
  "staff.start_approval": K(Play, "orange", "approvals", "Start approval"),
  "staff.start_decided": K(
    CircleCheck,
    "green",
    "approvals",
    "Start approval decided",
  ),
  "staff.reimbursement_decided": K(
    Receipt,
    "teal",
    "approvals",
    "Receipt decided",
  ),
  "staff.cash_over_limit": K(Banknote, "orange", "team", "Cash over limit"),
  "staff.cash_discrepancy": K(Scale, "red", "team", "Cash count mismatch"),
  "staff.remittance_request": K(HandCoins, "blue", "team", "Cash remittance"),
  "staff.settlement_ready": K(Wallet, "green", "team", "Pay statement ready"),
  "staff.settlement_flagged": K(Flag, "red", "team", "Statement flagged"),
  "staff.payout_sent": K(Banknote, "green", "team", "Payout sent"),
  "staff.comp_agreement": K(PenLine, "indigo", "team", "Pay agreement"),
  "staff.bank_changed": K(Landmark, "red", "team", "Bank details changed"),
  "staff.vehicle_due": K(Wrench, "orange", "fleet", "Vehicle service due"),
  "staff.doc_expiring": K(FileWarning, "orange", "fleet", "Document expiring"),
  "staff.vehicle_issue": K(Car, "red", "fleet", "Vehicle issue"),
  "staff.inspection_due": K(ClipboardList, "yellow", "fleet", "Inspection due"),
  "staff.tool_audit_due": K(ListChecks, "teal", "fleet", "Tool check"),
  "staff.tool_incident": K(Hammer, "red", "fleet", "Tool incident"),
  "staff.tool_maintenance_due": K(Wrench, "brown", "fleet", "Tool maintenance"),
  "staff.task_due": K(ListTodo, "blue", "other", "Task due"),
  "staff.daily_digest": K(Newspaper, "gray", "other", "Daily digest"),
  "staff.reminder": K(Bell, "purple", "other", "Reminder"),
};

const FALLBACK = K(Bell, "gray", "other", "Notification");

export function notifyKind(type: string): NotifyKind {
  return KINDS[type] ?? FALLBACK;
}

/** "Open lead", "Open job"… from the notification's link. */
export function openLabel(url: string | null): string {
  if (!url) return "Open";
  const path = url.split("?")[0] ?? "";
  if (path === "/messages/outbox") return "Open outbox";
  if (path === "/messages") return "Open messages";
  const seg = path.split("/")[1] ?? "";
  const noun: Record<string, string> = {
    leads: "lead",
    jobs: "job",
    estimates: "estimate",
    invoices: "invoice",
    messages: "conversation",
    customers: "customer",
    payments: "payment",
    disputes: "dispute",
    approvals: "approvals",
    payroll: "pay",
    pay: "pay",
    vehicles: "vehicle",
    tools: "tool",
    tasks: "task",
    schedule: "schedule",
    dispatch: "Assign",
    today: "Today",
  };
  const n = noun[seg];
  return n ? `Open ${n}` : "Open";
}
