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
  /**
   * Optional (Quote to Paid E3): one-tap add. With `onAddItem` a tap adds the item
   * at once (qty 1), a second tap adds one more and picked rows show a − n +
   * stepper; the sheet stays open until "Done". `picked` = the document's lines
   * that came from the price book (their current quantities).
   */
  title?: string;
  picked?: { pricebookItemId: string; lineId: string; qty: number }[];
  /** Add a new line; resolves to its id when known, else true/false. */
  onAddItem?: (item: PricebookPick, qty: number) => Promise<string | boolean>;
  /** Set a line's quantity (0 removes it). */
  onSetQty?: (lineId: string, qty: number) => Promise<boolean>;
  /** "Custom item": the caller opens its own line sheet. */
  onCustom?: () => void;
};

/** The picker's chips and the "Recent" list (S14 addition, Quote to Paid E3). */
export interface PricebookFacets {
  /** Distinct categories, A–Z. */
  categories: string[];
  /** Items this user added lately, newest first. */
  recent: PricebookPick[];
}
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
