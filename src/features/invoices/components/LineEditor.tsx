"use client";

import { Plus, Tag, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import {
  type ReactNode,
  useMemo,
  useOptimistic,
  useState,
  useTransition,
} from "react";
import { QtyStepper, TypeTile } from "@/features/pricebook/components/ItemBits";
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
// orders (SPEC M07/M08). Add from the price book with one tap per item (Quote to
// Paid E3: tap again for one more), tap a line to edit it in a sheet, or add a
// custom line. `layout="cards"` (the estimate builder, E2) shows item cards with a
// type tile, the full name, "× $129.00", an inline − 2 + stepper and the line
// total. The parent decides persistence: `onSave`/`onDelete` resolve truthy on
// success (immediate server actions, `{ id }` when the new line's id is known) or
// update local state (revise). `quiet` saves (picker taps, steppers) skip toasts.

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

/** What a save resolves to: success, or the saved line's id. */
export type LineSaveResult = boolean | { id: string };

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

/** A price-book pick as a new line (qty 1). */
function fromPick(p: PricebookPick): EditorLine {
  return {
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
  };
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
  layout = "rows",
  cardHeader,
  actions,
  pickerTitle,
}: {
  lines: EditorLine[];
  onSave: (
    line: EditorLine,
    opts?: { quiet?: boolean },
  ) => Promise<LineSaveResult>;
  onDelete?: (id: string, opts?: { quiet?: boolean }) => Promise<boolean>;
  variant: LineEditorVariant;
  readOnly?: boolean;
  allowDiscount?: boolean;
  showCost?: boolean;
  taxBps: number;
  taxExempt?: boolean;
  header?: string;
  footer?: ReactNode;
  emptyHint?: string;
  /** `cards`: item cards inside one card, the add buttons under it (E2). */
  layout?: "rows" | "cards";
  /** Cards: shown at the top of the card (e.g. the option's name and badges). */
  cardHeader?: ReactNode;
  /** More buttons after Add items / Discount (e.g. Photos). */
  actions?: ReactNode;
  /** The picker's title, e.g. "Add to Better". */
  pickerTitle?: string;
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
  // Stepper taps show at once; the server's lines replace them after the save.
  const [shown, setQtyNow] = useOptimistic(
    lines,
    (state, p: { id: string; qty: number }) =>
      state.map((l) => (l.id === p.id ? { ...l, qty: p.qty } : l)),
  );
  const totals = useMemo(
    () => editorTotals(shown, taxBps, taxExempt),
    [shown, taxBps, taxExempt],
  );
  const cards = layout === "cards";

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

  const setQty = (l: EditorLine, qty: number) => {
    if (!l.id || !(qty > 0)) return;
    const id = l.id;
    start(async () => {
      setQtyNow({ id, qty });
      await onSave({ ...l, qty }, { quiet: true });
    });
  };

  // The picker's one-tap add: the lines it changes are this editor's lines.
  const byId = new Map(lines.map((l) => [l.id, l]));
  const picked = lines
    .filter((l) => l.id && l.pricebookItemId)
    .map((l) => ({
      pricebookItemId: l.pricebookItemId as string,
      lineId: l.id as string,
      qty: l.qty,
    }));
  const addItem = async (p: PricebookPick, qty: number) => {
    const r = await onSave({ ...fromPick(p), qty }, { quiet: true });
    return typeof r === "object" ? r.id : r;
  };
  const setItemQty = async (lineId: string, qty: number) => {
    if (qty <= 0) return onDelete ? onDelete(lineId, { quiet: true }) : false;
    const l = byId.get(lineId);
    return l ? !!(await onSave({ ...l, qty }, { quiet: true })) : false;
  };
  const custom = () =>
    setEditing({
      type: "service",
      name: "",
      qty: 1,
      unitPriceCents: 0,
      taxable: false,
      isOptional: false,
      isSelected: true,
    });

  const addButtons = !readOnly && (
    <div
      className={
        cards ? "flex flex-wrap gap-2" : "flex flex-wrap gap-2 px-4 py-3"
      }
      onPointerOver={prefetchSheet}
      onFocusCapture={prefetchSheet}
    >
      {pickerArmed && (
        <PricebookPicker
          triggerLabel="Price book"
          onPick={(p) => setEditing(fromPick(p))}
          open={picker}
          onOpenChange={setPicker}
          title={pickerTitle}
          picked={picked}
          onAddItem={addItem}
          onSetQty={setItemQty}
          onCustom={() => {
            setPicker(false);
            custom();
          }}
        />
      )}
      <Button
        size={cards ? "md" : "sm"}
        variant="tinted"
        icon={<Plus size={cards ? 19 : 17} />}
        className={cards ? "flex-1 basis-36" : undefined}
        onClick={() => setPicker(true)}
        onPointerEnter={prefetchPicker}
        onFocus={prefetchPicker}
        aria-haspopup="dialog"
      >
        {cards ? "Add items" : "Price book"}
      </Button>
      {cards ? null : (
        <Button size="sm" variant="secondary" onClick={custom}>
          Custom line
        </Button>
      )}
      {allowDiscount && (
        <Button
          size={cards ? "md" : "sm"}
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
      {actions}
    </div>
  );

  const swipe = (l: EditorLine, node: ReactNode) =>
    readOnly || !l.id || !onDelete ? (
      node
    ) : (
      <SwipeActions
        trailing={[
          {
            label: "Remove",
            icon: <Trash2 size={18} />,
            destructive: true,
            onAction: () => remove(l),
          },
        ]}
      >
        {node}
      </SwipeActions>
    );

  return (
    <>
      {confirmEl}
      {cards ? (
        <>
          <section
            aria-label={header}
            className="rounded-card bg-card px-4 pt-3 pb-2 shadow-card sm:px-5"
          >
            {cardHeader}
            {shown.length === 0 ? (
              <p className="py-3 text-subhead text-label-2">{emptyHint}</p>
            ) : (
              <ul className="-mx-1">
                {shown.map((l) => (
                  <li key={l.id ?? l.name}>
                    {swipe(
                      l,
                      <ItemCard
                        line={l}
                        readOnly={readOnly}
                        showCost={showCost}
                        onEdit={() => setEditing(l)}
                        onQty={(q) => setQty(l, q)}
                      />,
                    )}
                  </li>
                ))}
              </ul>
            )}
            <dl className="mt-1 border-t border-sep pt-2 text-subhead text-label-2">
              {totals.discountCents > 0 && (
                <Sum label="Discount" cents={-totals.discountCents} />
              )}
              <Sum
                label={
                  taxExempt
                    ? "Tax (exempt)"
                    : `Tax ${Number((taxBps / 100).toFixed(3))}% on taxable items`
                }
                cents={totals.taxCents}
              />
            </dl>
            {footer ? (
              <div className="pb-1 text-footnote text-label-2">{footer}</div>
            ) : null}
          </section>
          {addButtons}
        </>
      ) : (
        <>
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
            {lines.map((l) => (
              <div key={l.id ?? l.name}>
                {swipe(
                  l,
                  <ListRow
                    title={
                      <span className="flex items-center gap-2">
                        <span className="truncate">{l.name}</span>
                        <LineBadges line={l} />
                      </span>
                    }
                    subtitle={lineSubtitle(l, showCost)}
                    detail={
                      <MoneyText
                        cents={lineTotal(l)}
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
                  />,
                )}
              </div>
            ))}
            {addButtons}
          </ListSection>
          <TotalsCard totals={totals} />
        </>
      )}
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
            const ok = !!(await onSave(l));
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

function LineBadges({ line: l }: { line: EditorLine }) {
  return (
    <>
      {l.isOptional && (
        <Pill size="sm" dot={false} tone={l.isSelected ? "green" : "gray"}>
          Add-on
        </Pill>
      )}
      {l.isUpsell && (
        <Pill size="sm" dot={false} tone="indigo">
          Upsell
        </Pill>
      )}
    </>
  );
}

/** One line as an item card: tile, full name, − 2 + × $129.00, line total. */
function ItemCard({
  line: l,
  readOnly,
  showCost,
  onEdit,
  onQty,
}: {
  line: EditorLine;
  readOnly?: boolean;
  showCost: boolean;
  onEdit: () => void;
  onQty: (qty: number) => void;
}) {
  const discount = l.type === "discount";
  const each = `× ${formatMoney(l.unitPriceCents)}`;
  const extra = [
    l.discountCents ? `−${formatMoney(l.discountCents)} off` : null,
    l.isServiceFee ? "Credited if approved" : null,
    showCost && l.unitCostCents != null
      ? `cost ${formatMoney(l.unitCostCents)}`
      : null,
  ].filter(Boolean);
  return (
    <div className="relative flex items-center gap-3 rounded-[14px] bg-card px-1 py-2.5">
      <TypeTile type={l.type} size={52} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body font-medium text-label">
          {readOnly ? (
            <span className="[overflow-wrap:anywhere]">{l.name}</span>
          ) : (
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Edit ${l.name}`}
              className="box-hit text-left outline-none [overflow-wrap:anywhere]"
            >
              {l.name}
            </button>
          )}
          <LineBadges line={l} />
        </p>
        {discount ? (
          <p className="text-subhead text-label-2">
            {discountKindLabel(l.name) ?? "Discount"}
          </p>
        ) : (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {readOnly || !l.id ? (
              <span className="num text-subhead text-label-2">
                {qtyFmt.format(l.qty)} {each}
              </span>
            ) : (
              <>
                <QtyStepper
                  value={l.qty}
                  onChange={onQty}
                  label={`Quantity of ${l.name}`}
                  className="relative z-[1]"
                />
                <span className="num text-subhead text-label-2">{each}</span>
              </>
            )}
            {extra.length > 0 && (
              <span className="text-footnote text-label-2">
                {extra.join(" · ")}
              </span>
            )}
          </div>
        )}
      </div>
      <MoneyText
        cents={lineTotal(l)}
        className={
          discount
            ? "shrink-0 text-headline text-danger"
            : "shrink-0 text-headline text-label"
        }
      />
    </div>
  );
}

function Sum({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt>{label}</dt>
      <dd className="num">{formatMoney(cents)}</dd>
    </div>
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
