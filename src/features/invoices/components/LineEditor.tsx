"use client";

import { Plus, Tag, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import type { PricebookPick } from "@/features/pricebook/contracts";
import { PricebookPicker } from "@/features/pricebook/slots.client";
import { newId } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { Select, TextArea, TextField } from "@/ui/components/Field";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyField } from "@/ui/components/MoneyField";
import { Sheet } from "@/ui/components/Sheet";
import { SwipeActions } from "@/ui/components/SwipeActions";
import { ToggleRow } from "@/ui/components/Toggle";
import { discountKindLabel } from "../line-labels";
import {
  computeLineTotal,
  computeTotals,
  type DocLineType,
  type DocTotals,
} from "../math";

// Line editor shared by the invoice draft/revision, estimate options and change
// orders (SPEC M07/M08). Tap a line to edit it in a sheet; add from the price book
// (S14) or as a custom line. The parent decides persistence: `onSave`/`onDelete`
// return true on success (immediate server actions) or update local state (revise).
// Rows carry no tags: lines are plain items. Optional add-on lines are legacy
// (estimates written before options replaced them): their row says "Optional" and
// only they keep the switch, so they can be turned into regular items.

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

const TYPE_LABEL: Record<DocLineType, string> = {
  service: "Service",
  labor: "Labor",
  part: "Part",
  material: "Material",
  fee: "Fee",
  discount: "Discount",
};

const SOURCE_LABEL = {
  company_stock: "Truck / warehouse stock",
  company_po: "Ordered by the company",
  company_card: "Company card",
  tech_purchased: "Bought by the tech",
} as const;

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
    if (l.isOptional)
      parts.push(
        l.isSelected === false ? "Optional, not in total" : "Optional",
      );
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
  const [editing, setEditing] = useState<EditorLine | null>(null);
  const [picker, setPicker] = useState(false);
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
        header={header}
        footer={footer}
        trailing={
          !readOnly ? (
            <span className="text-label-2">{lines.length || ""}</span>
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
              title={<span className="block truncate">{l.name}</span>}
              subtitle={lineSubtitle(l, showCost)}
              detail={
                <span
                  className={l.type === "discount" ? "text-danger" : undefined}
                >
                  {formatMoney(total)}
                </span>
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
          <div className="flex flex-wrap gap-2 px-4 py-3">
            <PricebookPicker
              triggerLabel="Price book"
              onPick={(p) => setEditing(fromPick(p))}
              open={picker}
              onOpenChange={setPicker}
            />
            <Button
              size="sm"
              variant="tinted"
              icon={<Plus size={17} />}
              onClick={() => setPicker(true)}
            >
              Price book
            </Button>
            <Button
              size="sm"
              variant="gray"
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
                variant="gray"
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
      <div className="list-row flex min-h-11 items-baseline justify-between px-4 py-[11px]">
        <dt className="text-headline">Total</dt>
        <dd className="num text-headline">{formatMoney(totals.totalCents)}</dd>
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

/* ------------------------------------------------------------------ line sheet */

function LineSheet({
  line,
  variant,
  allowDiscount,
  showCost,
  onClose,
  onSave,
  onDelete,
}: {
  line: EditorLine | null;
  variant: LineEditorVariant;
  allowDiscount: boolean;
  showCost: boolean;
  onClose: () => void;
  onSave: (l: EditorLine) => Promise<boolean>;
  onDelete?: () => Promise<void>;
}) {
  const [l, setL] = useState<EditorLine>(
    line ?? { type: "service", name: "", qty: 1, unitPriceCents: 0 },
  );
  const [qtyText, setQtyText] = useState(String(line?.qty ?? 1));
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<EditorLine>) => {
    setL((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const isPart = l.type === "part" || l.type === "material";
  const isDiscount = l.type === "discount";
  const qtyValid = Number.isFinite(l.qty) && l.qty > 0;
  const total = qtyValid ? lineTotal(l) : 0;
  // A discount needs an amount: a $0 discount line is noise on the customer's doc (T2-05).
  const amountValid = !isDiscount || l.unitPriceCents > 0;
  const canSave =
    l.name.trim().length > 0 && qtyValid && amountValid && !pending;

  const save = () =>
    start(async () => {
      setError(null);
      const ok = await onSave({
        ...l,
        id: l.id ?? undefined,
        name: l.name.trim(),
        taxable: isDiscount ? false : (l.taxable ?? false),
        partSource: isPart ? (l.partSource ?? "company_stock") : null,
      });
      if (!ok) setError("Couldn't save this line.");
      else setDirty(false);
    });

  return (
    <Sheet
      open={line != null}
      onOpenChange={(o) => !o && onClose()}
      title={line?.id ? "Edit line" : isDiscount ? "Discount" : "New line"}
      dirty={dirty}
      desktop="panel"
      leading={
        <Button variant="plain" size="sm" onClick={onClose}>
          Cancel
        </Button>
      }
      trailing={
        <Button
          variant="plain"
          size="sm"
          className="font-semibold"
          disabled={!canSave}
          loading={pending}
          onClick={save}
        >
          {line?.id ? "Save" : "Add"}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-[var(--gutter)] pb-8">
        {!isDiscount && (
          <Select
            label="Type"
            value={l.type}
            onChange={(e) =>
              set({ type: e.currentTarget.value as DocLineType })
            }
            options={(
              ["service", "labor", "part", "material", "fee"] as const
            ).map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
          />
        )}
        <TextField
          label={isDiscount ? "Label" : "Name"}
          value={l.name}
          onChange={(e) => set({ name: e.currentTarget.value })}
          maxLength={200}
          autoFocus={!line?.name}
          placeholder={isDiscount ? "Discount" : "What was done or sold"}
        />
        {!isDiscount && (
          <TextArea
            label="Description (shown to the customer)"
            value={l.description ?? ""}
            onChange={(e) => set({ description: e.currentTarget.value })}
            rows={2}
          />
        )}
        {isDiscount ? (
          <MoneyField
            label="Amount off"
            valueCents={l.unitPriceCents}
            onChangeCents={(c) => set({ unitPriceCents: Math.abs(c ?? 0) })}
            hint="Within your role's discount limit."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Quantity"
              inputMode="decimal"
              value={qtyText}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setQtyText(v);
                const n = Number(v);
                set({
                  qty: Number.isFinite(n)
                    ? Math.round(n * 1000) / 1000
                    : Number.NaN,
                });
              }}
              error={qtyValid ? null : "Enter a quantity above 0"}
            />
            <MoneyField
              label="Unit price"
              valueCents={l.unitPriceCents}
              onChangeCents={(c) => set({ unitPriceCents: c ?? 0 })}
            />
          </div>
        )}
        {!isDiscount && (showCost || allowDiscount) && (
          <div className="grid grid-cols-2 gap-3">
            {showCost && (
              <MoneyField
                label="Unit cost"
                valueCents={l.unitCostCents ?? null}
                onChangeCents={(c) => set({ unitCostCents: c })}
                hint="Internal only"
              />
            )}
            {allowDiscount && (
              <MoneyField
                label="Line discount"
                valueCents={l.discountCents ?? 0}
                onChangeCents={(c) => set({ discountCents: Math.abs(c ?? 0) })}
              />
            )}
          </div>
        )}
        {!isDiscount && (
          <div className="list-card">
            <ToggleRow
              title="Taxable"
              checked={l.taxable ?? false}
              onChange={(e) => set({ taxable: e.currentTarget.checked })}
            />
            {l.type === "service" && (
              <ToggleRow
                title="Service-call fee"
                subtitle="“Credited if you approve the repair”"
                checked={l.isServiceFee ?? false}
                onChange={(e) => set({ isServiceFee: e.currentTarget.checked })}
              />
            )}
            {/* New lines are never optional (the customer chooses between
                options, not items); a legacy optional line keeps the switch so
                it can be turned off (and back on before saving). */}
            {variant === "estimate" && line?.isOptional && (
              <ToggleRow
                title="Optional"
                subtitle="The customer ticks it on or off. Turn off to make it a regular item."
                checked={l.isOptional ?? false}
                onChange={(e) =>
                  set({
                    isOptional: e.currentTarget.checked,
                    isSelected: !e.currentTarget.checked,
                  })
                }
              />
            )}
            {/* ⚖️ Legal input, not a tag: it never shows on the row. */}
            {variant !== "invoice" && (
              <ToggleRow
                title="Beyond the requested repair"
                subtitle="⚖️ Counts toward the 3-day cooling-off notice"
                checked={l.isUpsell ?? false}
                onChange={(e) => set({ isUpsell: e.currentTarget.checked })}
              />
            )}
          </div>
        )}
        {isPart && (
          <Select
            label="Part source"
            value={l.partSource ?? "company_stock"}
            onChange={(e) =>
              set({
                partSource: e.currentTarget.value as EditorLine["partSource"],
              })
            }
            options={Object.entries(SOURCE_LABEL).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        )}
        {!isDiscount && (
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Warranty (days)"
              inputMode="numeric"
              value={l.warrantyDays == null ? "" : String(l.warrantyDays)}
              onChange={(e) => {
                const n = Number.parseInt(e.currentTarget.value, 10);
                set({ warrantyDays: Number.isFinite(n) && n >= 0 ? n : null });
              }}
            />
            {isPart ? (
              <TextField
                label="Serial #"
                value={l.serial ?? ""}
                onChange={(e) => set({ serial: e.currentTarget.value || null })}
              />
            ) : (
              <span />
            )}
          </div>
        )}
        <div className="flex items-baseline justify-between rounded-card bg-card px-4 py-3 shadow-card">
          <span className="text-body text-label-2">Line total</span>
          <span
            className={`num text-title3 font-semibold ${total < 0 ? "text-danger" : ""}`}
          >
            {formatMoney(total)}
          </span>
        </div>
        {error && (
          <p role="alert" className="px-1 text-subhead text-danger">
            {error}
          </p>
        )}
        {onDelete && (
          <Button
            variant="gray"
            className="text-danger"
            onClick={() => void onDelete()}
          >
            Remove line
          </Button>
        )}
      </div>
    </Sheet>
  );
}

/** New local id for unsaved lines (revision / estimate drafts held in memory). */
export const tempLineId = () => newId();
