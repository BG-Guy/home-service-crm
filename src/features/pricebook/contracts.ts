// Contract types for B3 price book (BUILD_PLAN §5.2, §6.3). Types only.
export type PricebookPick = {
  id: string;
  kind: "service" | "labor" | "part" | "material" | "fee";
  sku: string | null;
  name: string;
  description: string | null;
  unitPriceCents: number;
  unitCostCents: number | null;
  taxable: boolean;
  isSpecialOrder: boolean;
  warrantyDays: number | null;
  manufacturerWarrantyMonths: number | null;
  /** Optional (B3 addition): grouping in the picker. */
  category?: string | null;
};
export type PricebookPickerProps = {
  kinds?: PricebookPick["kind"][];
  onPick: (item: PricebookPick) => void;
  triggerLabel?: string;
  /** Optional (B3 addition): trigger style. */
  triggerVariant?: "filled" | "tinted" | "gray" | "plain";
  /** Optional (B3 addition): controlled open state (render without a trigger). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};
export interface PricebookUpsertRow {
  sku?: string | null;
  name: string;
  kind: PricebookPick["kind"];
  category?: string | null;
  unitCostCents?: number | null;
  unitPriceCents?: number | null;
  taxable?: boolean;
  isSpecialOrder?: boolean;
  vendor?: string | null;
  /** Optional (B3 additions). */
  description?: string | null;
  warrantyDays?: number | null;
  manufacturerWarrantyMonths?: number | null;
  active?: boolean;
}

/** Full row for the settings editor (B3 internal). */
export interface PricebookItemRow {
  id: string;
  kind: PricebookPick["kind"];
  sku: string | null;
  name: string;
  description: string | null;
  category: string | null;
  unitCostCents: number | null;
  /** Stored price (null = markup matrix). */
  unitPriceCents: number | null;
  /** Effective price (stored or matrix). */
  effectivePriceCents: number;
  avgCostCents: number | null;
  taxable: boolean;
  isSpecialOrder: boolean;
  vendor: string | null;
  warrantyDays: number | null;
  manufacturerWarrantyMonths: number | null;
  active: boolean;
}
