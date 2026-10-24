"use client";

import { useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import { Button } from "@/ui/components/Button";
import { Select, TextArea, TextField } from "@/ui/components/Field";
import { MoneyField } from "@/ui/components/MoneyField";
import { Sheet } from "@/ui/components/Sheet";
import { ToggleRow } from "@/ui/components/Toggle";
import type { DocLineType } from "../math";
import {
  type EditorLine,
  type LineEditorVariant,
  lineTotal,
} from "./LineEditor";

// The add / edit line sheet of LineEditor, a lazy chunk loaded on the first tap.
// Name, price and quantity first; the rest under "More details" (Quote to Paid E3:
// a custom item is three fields). Editing an existing line opens with it shown.

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

/* ------------------------------------------------------------------ line sheet */

export default function LineSheet({
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
  const [more, setMore] = useState(!!line?.id);
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

  const details = (
    <>
      <Select
        label="Type"
        value={l.type}
        onChange={(e) => set({ type: e.currentTarget.value as DocLineType })}
        options={(["service", "labor", "part", "material", "fee"] as const).map(
          (t) => ({ value: t, label: TYPE_LABEL[t] }),
        )}
      />
      <TextArea
        label="Description (shown to the customer)"
        value={l.description ?? ""}
        onChange={(e) => set({ description: e.currentTarget.value })}
        rows={2}
      />
      {(showCost || allowDiscount) && (
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
        {variant === "estimate" && (
          <ToggleRow
            title="Optional add-on"
            subtitle="The customer can tick it on or off"
            checked={l.isOptional ?? false}
            onChange={(e) =>
              set({
                isOptional: e.currentTarget.checked,
                isSelected: !e.currentTarget.checked,
              })
            }
          />
        )}
        {variant !== "invoice" && (
          <ToggleRow
            title="Beyond the requested repair"
            subtitle="⚖️ Counts toward the 3-day cooling-off notice"
            checked={l.isUpsell ?? false}
            onChange={(e) => set({ isUpsell: e.currentTarget.checked })}
          />
        )}
      </div>
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
    </>
  );

  return (
    <Sheet
      open={line != null}
      onOpenChange={(o) => !o && onClose()}
      title={line?.id ? "Edit item" : isDiscount ? "Discount" : "Custom item"}
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
        <TextField
          label={isDiscount ? "Label" : "Name"}
          value={l.name}
          onChange={(e) => set({ name: e.currentTarget.value })}
          maxLength={200}
          autoFocus={!line?.name}
          placeholder={isDiscount ? "Discount" : "What was done or sold"}
        />
        {isDiscount ? (
          <MoneyField
            label="Amount off"
            valueCents={l.unitPriceCents}
            onChangeCents={(c) => set({ unitPriceCents: Math.abs(c ?? 0) })}
            hint="Within your role's discount limit."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <MoneyField
              label="Price"
              valueCents={l.unitPriceCents}
              onChangeCents={(c) => set({ unitPriceCents: c ?? 0 })}
            />
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
          </div>
        )}
        {!isDiscount && (
          <>
            <Button
              variant="plain"
              size="sm"
              className="-ml-2 self-start"
              aria-expanded={more}
              onClick={() => setMore((m) => !m)}
            >
              {more ? "Fewer details" : `More details · ${TYPE_LABEL[l.type]}`}
            </Button>
            <div className="disclosure" data-open={more || undefined}>
              <div
                inert={!more || undefined}
                className="flex flex-col gap-4 pb-1"
              >
                {details}
              </div>
            </div>
          </>
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
