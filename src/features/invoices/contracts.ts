// Contract types for B3 invoices (BUILD_PLAN §5.2, §6.3). Types only.
export type LineType =
  | "service"
  | "labor"
  | "part"
  | "material"
  | "fee"
  | "discount";
export type PartSource =
  | "company_stock"
  | "company_po"
  | "company_card"
  | "tech_purchased";
export interface LineInput {
  type: LineType;
  pricebookItemId?: string | null;
  name: string;
  description?: string | null;
  qty: number;
  unitPriceCents: number;
  unitCostCents?: number | null;
  discountCents?: number;
  taxable?: boolean;
  partSource?: PartSource | null;
  partPurchaseId?: string | null;
  warrantyDays?: number | null;
  manufacturerWarrantyMonths?: number | null;
  serial?: string | null;
  isServiceFee?: boolean;
  isUpsell?: boolean;
}
export interface JobLine extends LineInput {
  id: string;
  invoiceId: string;
  totalCents: number;
  invoiceStatus: string;
}
export type InvoiceStatus =
  | "draft"
  | "issued"
  | "partially_paid"
  | "paid"
  | "void"
  | "uncollectible";
export interface InvoiceSummary {
  id: string;
  number: string;
  jobId: string | null;
  customerId: string;
  status: InvoiceStatus;
  version: number;
  issuedAt: Date | null;
  dueAt: Date | null;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  balanceCents: number;
}
export type JobInvoicePanelProps = { jobId: string };
export type CustomerInvoicesPanelProps = { customerId: string };
