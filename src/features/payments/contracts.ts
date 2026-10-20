// Contract types for B4 payments (BUILD_PLAN §5.2, §6.4). Types only.
import type { PaymentStatus } from "@/features/jobs/contracts";

export interface InvoiceBalance {
  invoiceId: string;
  totalCents: number;
  paidCents: number;
  refundedCents: number;
  creditedCents: number;
  balanceCents: number;
}
export interface PaymentBrief {
  id: string;
  kind: "deposit" | "payment" | "tip_only";
  method: string;
  provider: string;
  status: string;
  amountCents: number;
  tipCents: number;
  feeCents: number;
  succeededAt: Date | null;
  collectedByUserId: string | null;
  verifiedAt: Date | null;
  last4: string | null;
  entryMode: string | null;
  refundedCents: number;
}
export interface DepositBrief {
  id: string;
  jobId: string | null;
  estimateId: string | null;
  amountCents: number;
  mode: "capture" | "hold" | "card_on_file" | "manual";
  status: string;
  dueAt: Date | null;
  paidAt: Date | null;
  policyVersionId: string | null;
  capWarning: string | null;
}
export interface JobMoney {
  jobId: string;
  invoiceId: string | null;
  totalCents: number;
  balanceCents: number;
  paidCents: number;
  depositPaidCents: number;
  paymentStatus: PaymentStatus;
  deposits: DepositBrief[];
  payments: PaymentBrief[];
}
export interface RecordPaymentInput {
  customerId: string;
  invoiceId?: string | null;
  jobId?: string | null;
  depositRequestId?: string | null;
  kind: "deposit" | "payment" | "tip_only";
  method: "cash" | "check" | "zelle" | "venmo" | "ach" | "other";
  amountCents: number;
  tipCents?: number;
  reference?: string | null;
  proofMediaId?: string | null;
  collectedByUserId?: string | null;
  payerName?: string | null;
  clientId?: string | null;
  clientTs?: Date | null;
}
export interface ReceiptData {
  paymentId: string;
  invoiceId: string | null;
  jobId: string | null;
  jobNumber: string | null;
  customerId: string;
  amountCents: number;
  tipCents: number;
  method: string;
  methodLabel: string; // "cash", "Visa ••4242"
  last4: string | null;
  entryMode: string | null;
  authCode: string | null;
  at: Date;
  collectedByName: string | null;
  remainingBalanceCents: number | null;
}

// §5.2 slot props
export type JobPaymentsPanelProps = {
  jobId: string;
  /** The page shows Collect in its own bar (invoice detail): omit the panel's button. */
  hideCollect?: boolean;
};
export type CustomerPaymentsPanelProps = { customerId: string };
export type DepositChipProps = { jobId: string };
export type CollectPaymentButtonProps = {
  jobId?: string;
  invoiceId?: string;
  label?: string;
  variant?: "filled" | "tinted" | "gray";
  size?: "md" | "lg";
  fullWidth?: boolean;
  allowDeposit?: boolean;
};
export type RecordPaymentButtonProps = {
  customerId: string;
  invoiceId?: string;
  size?: "sm" | "md";
};
export type ReceiptFlagButtonProps = { token: string; paymentId: string };

// ---- B4 internal DTOs (serializable; used by B4 screens and slots) ----

/** A payment row in lists (dates as ISO strings). */
export interface PaymentListRow {
  id: string;
  kind: string;
  method: string;
  methodLabel: string;
  provider: string;
  status: string;
  amountCents: number;
  tipCents: number;
  feeCents: number;
  feeSource: string;
  refundedCents: number;
  at: string;
  customerId: string;
  customerName: string;
  jobId: string | null;
  jobNumber: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  collectedByName: string | null;
  reference: string | null;
  entryMode: string | null;
  verifiedAt: string | null;
  needsVerify: boolean;
  staleUnverified: boolean;
  providerRef: string | null;
  proofMediaId: string | null;
}

export interface RefundListRow {
  id: string;
  paymentId: string;
  amountCents: number;
  reason: string;
  status: string;
  dueAt: string | null;
  overdue: boolean;
  createdAt: string;
  completedAt: string | null;
  customerName: string;
  jobId: string | null;
  jobNumber: string | null;
  methodLabel: string;
  provider: string;
  createdByName: string | null;
}

/** Collect-payment sheet context (S19/S20). */
export interface CollectContext {
  jobId: string | null;
  jobNumber: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
  customerId: string | null;
  customerName: string | null;
  customerHasPhone: boolean;
  customerHasEmail: boolean;
  totalCents: number;
  balanceCents: number;
  feeLinesCents: number;
  depositPaid: { amountCents: number; at: string | null } | null;
  openDeposit: {
    id: string;
    amountCents: number;
    mode: string;
    status: string;
  } | null;
  methods: string[];
  tipsEnabled: boolean;
  tipPresets: number[];
  tipOnFees: boolean;
  referenceRequired: string[];
  requireCheckPhoto: boolean;
  /** A card processor with hosted pay links is configured. */
  cardLinks: boolean;
  keyedAllowed: boolean;
  riskBand: "low" | "medium" | "high" | "critical" | null;
  cardRestriction: string | null;
  feePolicy: "absorb" | "cash_discount" | "surcharge";
  cashDiscountBps: number;
  canRecordManual: boolean;
  canCollectCard: boolean;
  isTech: boolean;
  userId: string;
  prepayRequired: boolean;
}
