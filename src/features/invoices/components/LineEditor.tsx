"use client";

import { Plus, Tag, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import {
  type ComponentType,
  type ReactNode,
  useMemo,
  useState,
  useTransition,
} from "react";
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

// The line sheet and the price-book picker (with its one-tap glue, LinePicker)
// are lazy chunks (loaded on hover, focus or the first tap), so a document page
// ships only the rows and totals.
const loadSheet = () => import("./LineSheet");
const LineSheet = dynamic(loadSheet, { ssr: false });
const loadPicker = () => import("./LinePicker");
const LinePicker = dynamic(loadPicker, { ssr: false });
const prefetchSheet = () => void loadSheet();
const prefetchPicker = () => {
  void loadPicker();
  void loadSheet();
};

// Line editor shared by the invoice draft/revision, estimate options and change
// orders (SPEC M07/M08). Add from the price book with one tap per item (Quote to
// Paid E3: tap again for one more), tap a line to edit it in a sheet, or add a
// custom line. With `cardsView` (the estimate builder passes LineCards, E2) the
// lines show as item cards instead of rows. The parent decides persistence:
// `onSave`/`onDelete` resolve truthy on success (immediate server actions, `{ id }`
// when the new line's id is known) or update local state (revise). `quiet` saves
// (picker taps, steppers) skip toasts.

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

export type LineSave = (
  line: EditorLine,
  opts?: { quiet?: boolean },
) => Promise<LineSaveResult>;

/** What LineEditor hands a `cardsView` (LineCards): its own props, plus these. */
export interface LineCardsViewProps extends LineEditorProps {
  onEdit: (l: EditorLine) => void;
  onAdd: () => void;
  onAddDiscount: () => void;
  onPrefetch: () => void;
  /** Wraps a card in the remove swipe (or returns it as is). */
  swipe: (l: EditorLine, node: ReactNode) => ReactNode;
}

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

export interface LineEditorProps {
  lines: EditorLine[];
  onSave: LineSave;
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
  /** Item cards instead of rows (the estimate builder passes LineCards, E2). */
  cardsView?: ComponentType<LineCardsViewProps>;
  /** Cards: shown at the top of the card (e.g. the option's name and badges). */
  cardHeader?: ReactNode;
  /** More buttons after the add buttons (e.g. Photos). */
  actions?: ReactNode;
  /** The picker's title, e.g. "Add to Better". */
  pickerTitle?: string;
}

export function LineEditor(props: LineEditorProps) {
  const {
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
    cardsView: Cards,
    actions,
    pickerTitle,
  } = props;
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
  const discount = () =>
    setEditing({
      type: "discount",
      name: "Discount",
      qty: 1,
      unitPriceCents: 0,
      taxable: false,
    });
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
      {Cards ? (
        <Cards
          {...props}
          onEdit={setEditing}
          onAdd={() => setPicker(true)}
          onAddDiscount={discount}
          onPrefetch={prefetchPicker}
          swipe={swipe}
        />
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
            {!readOnly && (
              <div
                className="flex flex-wrap gap-2 px-4 py-3"
                onPointerOver={prefetchSheet}
                onFocusCapture={prefetchSheet}
              >
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
                <Button size="sm" variant="secondary" onClick={custom}>
                  Custom line
                </Button>
                {allowDiscount && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Tag size={16} />}
                    onClick={discount}
                  >
                    Discount
                  </Button>
                )}
                {actions}
              </div>
            )}
          </ListSection>
          <TotalsCard totals={totals} />
        </>
      )}
      {pickerArmed && (
        <LinePicker
          open={picker}
          onOpenChange={setPicker}
          title={pickerTitle}
          lines={lines}
          onSave={onSave}
          onDelete={onDelete}
          onCustom={() => {
            setPicker(false);
            custom();
          }}
        />
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

export function LineBadges({ line: l }: { line: EditorLine }) {
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
