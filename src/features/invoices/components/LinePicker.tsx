"use client";

import type { PricebookPick } from "@/features/pricebook/contracts";
import { PricebookPicker } from "@/features/pricebook/slots.client";
import type { EditorLine, LineSaveResult } from "./LineEditor";

// LineEditor's price book (Quote to Paid E3): one tap adds an item to the document
// at once, a second tap adds one more, picked rows step their quantity; the sheet
// stays open until "Done". The glue between the picker and the editor's
// onSave / onDelete lives in this lazy chunk with the picker itself.

/** A price-book pick as a new line. */
function fromPick(p: PricebookPick, qty: number): EditorLine {
  return {
    type: p.kind,
    pricebookItemId: p.id,
    name: p.name,
    description: p.description,
    qty,
    unitPriceCents: p.unitPriceCents,
    unitCostCents: p.unitCostCents,
    taxable: p.taxable,
    partSource:
      p.kind === "part" || p.kind === "material" ? "company_stock" : null,
    warrantyDays: p.warrantyDays,
    manufacturerWarrantyMonths: p.manufacturerWarrantyMonths,
    isServiceFee:
      p.kind === "service" && /service call|diagnostic/i.test(p.name),
    isOptional: false,
    isSelected: true,
  };
}

export default function LinePicker({
  open,
  onOpenChange,
  title,
  lines,
  onSave,
  onDelete,
  onCustom,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  /** The document's current lines. */
  lines: EditorLine[];
  onSave: (
    line: EditorLine,
    opts?: { quiet?: boolean },
  ) => Promise<LineSaveResult>;
  onDelete?: (id: string, opts?: { quiet?: boolean }) => Promise<boolean>;
  onCustom: () => void;
}) {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const picked = lines
    .filter((l) => l.id && l.pricebookItemId)
    .map((l) => ({
      pricebookItemId: l.pricebookItemId as string,
      lineId: l.id as string,
      qty: l.qty,
    }));
  const addItem = async (p: PricebookPick, qty: number) => {
    const r = await onSave(fromPick(p, qty), { quiet: true });
    return typeof r === "object" ? r.id : r;
  };
  const setItemQty = async (lineId: string, qty: number) => {
    if (qty <= 0) return onDelete ? onDelete(lineId, { quiet: true }) : false;
    const l = byId.get(lineId);
    return l ? !!(await onSave({ ...l, qty }, { quiet: true })) : false;
  };
  return (
    <PricebookPicker
      triggerLabel="Price book"
      onPick={(p) => void addItem(p, 1)}
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      picked={picked}
      onAddItem={addItem}
      onSetQty={setItemQty}
      onCustom={onCustom}
    />
  );
}
