"use client";

import { Plus, Tag } from "lucide-react";
import { useMemo, useOptimistic, useTransition } from "react";
import { QtyStepper, TypeTile } from "@/features/pricebook/components/ItemBits";
import { formatMoney } from "@/lib/money";
import { Button } from "@/ui/components/Button";
import { MoneyText } from "@/ui/components/MoneyText";
import { discountKindLabel } from "../line-labels";
import {
  type EditorLine,
  editorTotals,
  LineBadges,
  type LineCardsViewProps,
  lineTotal,
} from "./LineEditor";

// LineEditor's `cardsView` (Quote to Paid E2, the estimate builder passes it):
// item cards with a type tile, the full name, an inline − 2 + stepper, "× $129.00"
// and the line total, inside one card with the tax line, then Add items /
// Discount. Its own chunk: documents with rows (invoices, change orders) never
// load it.

const qtyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

export default function LineCards({
  header = "Items",
  cardHeader,
  lines: serverLines,
  taxBps,
  taxExempt,
  footer,
  emptyHint,
  readOnly,
  showCost = false,
  allowDiscount = true,
  actions,
  onEdit,
  onSave,
  onAdd,
  onAddDiscount,
  onPrefetch,
  swipe,
}: LineCardsViewProps) {
  // Stepper taps show at once; the server's lines replace them after the save.
  const [lines, setQtyNow] = useOptimistic(
    serverLines,
    (state, p: { id: string; qty: number }) =>
      state.map((l) => (l.id === p.id ? { ...l, qty: p.qty } : l)),
  );
  const [, start] = useTransition();
  const onQty = (l: EditorLine, qty: number) => {
    if (!l.id || !(qty > 0)) return;
    const id = l.id;
    start(async () => {
      setQtyNow({ id, qty });
      await onSave({ ...l, qty }, { quiet: true });
    });
  };
  const totals = useMemo(
    () => editorTotals(lines, taxBps, taxExempt),
    [lines, taxBps, taxExempt],
  );
  return (
    <>
      <section
        aria-label={header}
        className="rounded-card bg-card px-4 pt-3 pb-2 shadow-card sm:px-5"
      >
        {cardHeader}
        {lines.length === 0 ? (
          <p className="py-3 text-subhead text-label-2">{emptyHint}</p>
        ) : (
          <ul className="-mx-1">
            {lines.map((l) => (
              <li key={l.id ?? l.name}>
                {swipe(
                  l,
                  <ItemCard
                    line={l}
                    readOnly={readOnly}
                    showCost={showCost}
                    onEdit={() => onEdit(l)}
                    onQty={(q) => onQty(l, q)}
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
      {readOnly ? null : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="tinted"
            icon={<Plus size={19} />}
            className="flex-1 basis-36"
            onClick={onAdd}
            onPointerEnter={onPrefetch}
            onFocus={onPrefetch}
            aria-haspopup="dialog"
          >
            Add items
          </Button>
          {allowDiscount && (
            <Button
              variant="secondary"
              icon={<Tag size={16} />}
              onClick={onAddDiscount}
            >
              Discount
            </Button>
          )}
          {actions}
        </div>
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
