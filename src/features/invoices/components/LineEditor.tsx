"use client";

import { Plus, Tag, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo, useState, useTransition } from "react";
import type { PricebookPick } from "@/features/pricebook/contracts";
import { newId } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { Pill } from "@/ui/components/StatusPill";
import { SwipeActions } from "@/ui/components/SwipeActions";
import { discountKindLabel } from "../line-labels";
import {
  computeLineTotal,
  computeTotals,
  type DocLineType,
  type DocTotals,
} from "../math";

// The line sheet and the price-book picker are lazy chunks (loaded on hover,
// focus or the first tap), so a document page ships only the rows and totals.
const loadSheet = () => import("./LineSheet");
const LineSheet = dynamic(loadSheet, { ssr: false });
const loadPicker = () => import("@/features/pricebook/slots.client");
const PricebookPicker = dynamic(
  () => loadPicker().then((m) => m.PricebookPicker),
  { ssr: false },
);
const prefetchSheet = () => void loadSheet();
const prefetchPicker = () => {
  void loadPicker();
  void loadSheet();
};

// Line editor shared by the invoice draft/revision, estimate options and change
// orders (SPEC M07/M08). Tap a line to edit it in a sheet; add from the price book
// (S14) or as a custom line. The parent decides persistence: `onSave`/`onDelete`
// return true on success (immediate server actions) or update local state (revise).

export interface EditorLine {
  id?: string;
  type: DocLineType;
  pricebookItemId?: string | null;
  name: string;
  description?: string | null;
  qty: number;
  unitPriceCents: number;
  unitCostCents?: number | null;
  discountCents?: number;
  taxable?: boolean;
  partSource?:
    | "company_stock"
    | "company_po"
    | "company_card"
    | "tech_purchased"
    | null;
  warrantyDays?: number | null;
  manufacturerWarrantyMonths?: number | null;
  serial?: string | null;
  isServiceFee?: boolean;
  isUpsell?: boolean;
  isOptional?: boolean;
  isSelected?: boolean;
  totalCents?: number;
}

export type LineEditorVariant = "invoice" | "estimate" | "change_order";

export function lineTotal(l: EditorLine): number {
  return computeLineTotal({
    type: l.type,
    qty: l.qty,
    unitPriceCents: l.unitPriceCents,
    discountCents: l.discountCents ?? 0,
  });
}

export function editorTotals(
  lines: readonly EditorLine[],
  taxBps: number,
  taxExempt = false,
): DocTotals {
  return computeTotals(
    lines.map((l) => ({
      type: l.type,
      totalCents: lineTotal(l),
      taxable: l.type === "discount" ? false : (l.taxable ?? false),
      isOptional: l.isOptional,
      isSelected: l.isSelected,
    })),
    taxBps,
    { taxExempt },
  );
}

const qtyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

export function lineSubtitle(l: EditorLine, showCost = false): string {
  const parts: string[] = [];
  if (l.type === "discount") {
    const kind = discountKindLabel(l.name);
    if (kind) parts.push(kind);
  } else {
    parts.push(`${qtyFmt.format(l.qty)} × ${formatMoney(l.unitPriceCents)}`);
    if (l.discountCents) parts.push(`−${formatMoney(l.discountCents)} off`);
    if (l.taxable) parts.push("Taxable");
    if (l.isServiceFee) parts.push("Credited if approved");
    if (showCost && l.unitCostCents != null)
      parts.push(`cost ${formatMoney(l.unitCostCents)}`);
  }
  return parts.join(" · ");
}

export function LineEditor({
  lines,
  onSave,
  onDelete,
  variant,
  readOnly,
  allowDiscount = true,
  showCost = false,
  taxBps,
  taxExempt,
  header = "Items",
  footer,
  emptyHint = "Add items from the price book or type a custom line.",
}: {
  lines: EditorLine[];
  onSave: (line: EditorLine) => Promise<boolean>;
  onDelete?: (id: string) => Promise<boolean>;
  variant: LineEditorVariant;
  readOnly?: boolean;
  allowDiscount?: boolean;
  showCost?: boolean;
  taxBps: number;
  taxExempt?: boolean;
  header?: string;
  footer?: React.ReactNode;
  emptyHint?: string;
}) {
  const [editing, setEditingState] = useState<EditorLine | null>(null);
  const [picker, setPickerState] = useState(false);
  const [sheetArmed, setSheetArmed] = useState(false);
  const [pickerArmed, setPickerArmed] = useState(false);
  const setEditing = (l: EditorLine | null) => {
    if (l) setSheetArmed(true);
    setEditingState(l);
  };
  const setPicker = (v: boolean) => {
    if (v) setPickerArmed(true);
    setPickerState(v);
  };
  const [confirm, confirmEl] = useConfirm();
  const [, start] = useTransition();
  const totals = useMemo(
    () => editorTotals(lines, taxBps, taxExempt),
    [lines, taxBps, taxExempt],
  );

  const fromPick = (p: PricebookPick): EditorLine => ({
    type: p.kind,
    pricebookItemId: p.id,
    name: p.name,
    description: p.description,
    qty: 1,
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
  });

  // Confirm before starting the transition (QA T2-01).
  const remove = async (l: EditorLine) => {
    if (!l.id || !onDelete) return;
    const id = l.id;
    if (
      !(await confirm({
        title: `Remove “${l.name}”?`,
        confirmLabel: "Remove",
        destructive: true,
      }))
    )
      return;
    start(async () => {
      await onDelete(id);
    });
  };

  return (
    <>
      {confirmEl}
      <ListSection
        variant="title"
        header={header}
        footer={footer}
        trailing={
          !readOnly && lines.length > 0 ? (
            <span className="num text-subhead text-label-2">
              {lines.length} {lines.length === 1 ? "item" : "items"}
            </span>
          ) : null
        }
      >
        {lines.length === 0 ? (
          <p className="px-4 py-4 text-subhead text-label-2">{emptyHint}</p>
        ) : null}
        {lines.map((l) => {
          const total = lineTotal(l);
          const row = (
            <ListRow
              key={l.id ?? l.name}
              title={
                <span className="flex items-center gap-2">
                  <span className="truncate">{l.name}</span>
                  {l.isOptional && (
                    <Pill
                      size="sm"
                      dot={false}
                      tone={l.isSelected ? "green" : "gray"}
                    >
                      Add-on
                    </Pill>
                  )}
                  {l.isUpsell && (
                    <Pill size="sm" dot={false} tone="indigo">
                      Upsell
                    </Pill>
                  )}
                </span>
              }
              subtitle={lineSubtitle(l, showCost)}
              detail={
                <MoneyText
                  cents={total}
                  className={
                    l.type === "discount"
                      ? "font-medium text-danger"
                      : "font-medium text-label"
                  }
                />
              }
              onClick={readOnly ? undefined : () => setEditing(l)}
              accessory={readOnly ? "none" : "chevron"}
              multiline
            />
          );
          return readOnly || !l.id || !onDelete ? (
            <div key={l.id ?? l.name}>{row}</div>
          ) : (
            <SwipeActions
              key={l.id}
              trailing={[
                {
                  label: "Remove",
                  icon: <Trash2 size={18} />,
                  destructive: true,
                  onAction: () => remove(l),
                },
              ]}
            >
              {row}
            </SwipeActions>
          );
        })}
        {!readOnly && (
          <div
            className="flex flex-wrap gap-2 px-4 py-3"
            onPointerOver={prefetchSheet}
            onFocusCapture={prefetchSheet}
          >
            {pickerArmed && (
              <PricebookPicker
                triggerLabel="Price book"
                onPick={(p) => setEditing(fromPick(p))}
                open={picker}
                onOpenChange={setPicker}
              />
            )}
            <Button
              size="sm"
              variant="tinted"
              icon={<Plus size={17} />}
              onClick={() => setPicker(true)}
              onPointerEnter={prefetchPicker}
              onFocus={prefetchPicker}
              aria-haspopup="dialog"
            >
              Price book
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setEditing({
                  type: variant === "invoice" ? "service" : "service",
                  name: "",
                  qty: 1,
                  unitPriceCents: 0,
                  taxable: false,
                  isOptional: false,
                  isSelected: true,
                })
              }
            >
              Custom line
            </Button>
            {allowDiscount && (
              <Button
                size="sm"
                variant="secondary"
                icon={<Tag size={16} />}
                onClick={() =>
                  setEditing({
                    type: "discount",
                    name: "Discount",
                    qty: 1,
                    unitPriceCents: 0,
                    taxable: false,
                  })
                }
              >
                Discount
              </Button>
            )}
          </div>
        )}
      </ListSection>
      <TotalsCard totals={totals} />
      {sheetArmed && (
        <LineSheet
          key={
            editing
              ? (editing.id ?? `new-${editing.pricebookItemId ?? editing.type}`)
              : "none"
          }
          line={editing}
          variant={variant}
          allowDiscount={allowDiscount}
          showCost={showCost}
          onClose={() => setEditing(null)}
          onSave={async (l) => {
            const ok = await onSave(l);
            if (ok) setEditing(null);
            return ok;
          }}
          onDelete={
            editing?.id && onDelete
              ? async () => {
                  const ok = await onDelete(editing.id as string);
                  if (ok) setEditing(null);
                }
              : undefined
          }
        />
      )}
    </>
  );
}

export function TotalsCard({
  totals,
  className,
}: {
  totals: DocTotals;
  className?: string;
}) {
  return (
    <dl className={`list-card ${className ?? ""}`}>
      <Row label="Subtotal" cents={totals.subtotalCents} />
      {totals.discountCents > 0 && (
        <Row label="Discount" cents={-totals.discountCents} />
      )}
      <Row label="Tax" cents={totals.taxCents} />
      <div className="list-row flex min-h-14 items-baseline justify-between px-4 py-3">
        <dt className="text-headline">Total</dt>
        <dd className="num text-title3 text-label">
          {formatMoney(totals.totalCents)}
        </dd>
      </div>
    </dl>
  );
}

function Row({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="list-row flex min-h-11 items-baseline justify-between px-4 py-[11px]">
      <dt className="text-body text-label-2">{label}</dt>
      <dd className="num text-body">{formatMoney(cents)}</dd>
    </div>
  );
}

/** New local id for unsaved lines (revision / estimate drafts held in memory). */
export const tempLineId = () => newId();
