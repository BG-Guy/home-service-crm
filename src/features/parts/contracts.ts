// Contract types for B6 parts (BUILD_PLAN §5.2, §6.6). Types only.
export interface CreatePartPurchaseInput {
  paidBy: "company" | "tech";
  instrument?: "personal" | "company_card" | "company_account" | "po" | null;
  purchaserUserId: string;
  category: "part" | "fuel" | "vehicle" | "tool" | "supplies" | "other";
  jobId?: string | null;
  vehicleId?: string | null;
  toolId?: string | null;
  vendor?: string | null;
  purchasedOn: string;
  subtotalCents?: number | null;
  taxCents?: number | null;
  totalCents: number;
  receiptMediaId?: string | null;
  notes?: string | null;
  clientId?: string | null;
}
export type UnreceiptedPart = {
  lineItemId: string;
  jobId: string;
  jobNumber: string;
  name: string;
  totalCents: number;
};

// §5.2 slot props
export type JobPartsPanelProps = { jobId: string };
export type AddPartButtonProps = {
  jobId: string;
  mode?:
    | "any"
    | "stock"
    | "pricebook"
    | "tech_paid"
    | "company_card"
    | "special_order";
  label?: string;
};
export type UnreceiptedPartsSectionProps = { userId: string; date?: string };
