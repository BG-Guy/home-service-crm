"use client";

import {
  Archive,
  ArchiveRestore,
  Download,
  FileUp,
  PackagePlus,
  Plus,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import { useConfirm } from "@/ui/components/Alert";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { EmptyState } from "@/ui/components/EmptyState";
import { Select, TextArea, TextField } from "@/ui/components/Field";
import { IconButton } from "@/ui/components/IconButton";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyField } from "@/ui/components/MoneyField";
import { SearchField } from "@/ui/components/SearchField";
import { Sheet } from "@/ui/components/Sheet";
import { SwipeActions } from "@/ui/components/SwipeActions";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import {
  deletePricebookItem,
  importPricebookRows,
  saveMarkupTiers,
  savePricebookItem,
  setPricebookItemActive,
} from "../actions";
import type { PricebookItemRow, PricebookPick } from "../contracts";
import { parseCsv, rowsFromCsv, toCsv } from "../csv";
import {
  type MarkupTier,
  marginPct,
  markupPct,
  multToMarginPct,
  priceForCost,
} from "../markup";

const KINDS: { value: PricebookPick["kind"]; label: string }[] = [
  { value: "service", label: "Service" },
  { value: "labor", label: "Labor" },
  { value: "part", label: "Part" },
  { value: "material", label: "Material" },
  { value: "fee", label: "Fee" },
];

type Filter = "all" | PricebookPick["kind"] | "archived";

export function PricebookManager({
  items,
  tiers,
}: {
  items: PricebookItemRow[];
  tiers: MarkupTier[];
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<PricebookItemRow | "new" | null>(null);
  const [confirm, confirmEl] = useConfirm();
  const [, start] = useTransition();

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((i) => {
      if (filter === "archived" ? i.active : !i.active) return false;
      if (filter !== "all" && filter !== "archived" && i.kind !== filter)
        return false;
      if (!term) return true;
      return [i.name, i.sku, i.category, i.vendor]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(term));
    });
  }, [items, q, filter]);

  const groups = useMemo(() => {
    const m = new Map<string, PricebookItemRow[]>();
    for (const i of visible) {
      const k = i.category?.trim() || "Uncategorized";
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    return [...m.entries()];
  }, [visible]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, archived: 0 };
    for (const i of items) {
      if (!i.active) {
        c.archived = (c.archived ?? 0) + 1;
        continue;
      }
      c.all = (c.all ?? 0) + 1;
      c[i.kind] = (c[i.kind] ?? 0) + 1;
    }
    return c;
  }, [items]);

  const categories = useMemo(
    () =>
      [
        ...new Set(items.map((i) => i.category).filter(Boolean)),
      ].sort() as string[],
    [items],
  );

  const toggleActive = (i: PricebookItemRow) =>
    start(async () => {
      const r = await setPricebookItemActive({ id: i.id, active: !i.active });
      toast(
        r.ok
          ? { title: i.active ? "Archived" : "Restored", tone: "success" }
          : { title: r.error, tone: "error" },
      );
    });

  const remove = async (i: PricebookItemRow) => {
    if (
      !(await confirm({
        title: `Delete “${i.name}”?`,
        message:
          "It disappears from the price book. Estimates and invoices that already use it keep their lines.",
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    const r = await deletePricebookItem({ id: i.id });
    toast(
      r.ok
        ? { title: "Deleted", tone: "success" }
        : { title: r.error, tone: "error" },
    );
  };

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {confirmEl}
      <div className="flex flex-col gap-2">
        <SearchField
          placeholder="Search name, SKU, category"
          onSearch={setQ}
          showCancel={false}
        />
        <ChipRow label="Filter items">
          {(
            [
              ["all", "All"],
              ["service", "Services"],
              ["labor", "Labor"],
              ["part", "Parts"],
              ["material", "Materials"],
              ["fee", "Fees"],
              ["archived", "Archived"],
            ] as [Filter, string][]
          ).map(([v, label]) => (
            <Chip
              key={v}
              selected={filter === v}
              count={counts[v] ?? 0}
              onClick={() => setFilter(v)}
            >
              {label}
            </Chip>
          ))}
        </ChipRow>
      </div>

      {groups.length === 0 ? (
        <div className="list-card">
          <EmptyState
            compact
            icon={<PackagePlus size={44} />}
            title={items.length ? "No matching items" : "Build your price book"}
            message={
              items.length
                ? "Try another search or filter."
                : "Add the services, parts and fees you sell so estimates and invoices take seconds."
            }
            action={
              <Button
                icon={<Plus size={18} />}
                onClick={() => setEditing("new")}
              >
                Add item
              </Button>
            }
          />
        </div>
      ) : (
        groups.map(([cat, list]) => (
          <ListSection
            key={cat}
            header={cat}
            trailing={<span className="text-label-2">{list.length}</span>}
          >
            {list.map((i) => {
              const margin = marginPct(i.effectivePriceCents, i.unitCostCents);
              return (
                <SwipeActions
                  key={i.id}
                  trailing={[
                    {
                      label: i.active ? "Archive" : "Restore",
                      icon: i.active ? (
                        <Archive size={18} />
                      ) : (
                        <ArchiveRestore size={18} />
                      ),
                      tone: "orange",
                      onAction: () => toggleActive(i),
                    },
                    {
                      label: "Delete",
                      icon: <Trash2 size={18} />,
                      destructive: true,
                      onAction: () => void remove(i),
                    },
                  ]}
                >
                  <ListRow
                    title={i.name}
                    subtitle={[
                      KINDS.find((k) => k.value === i.kind)?.label,
                      i.sku,
                      i.unitPriceCents == null ? "Priced by markup" : null,
                      margin != null ? `${margin}% margin` : null,
                      i.isSpecialOrder ? "Special order" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    detail={formatMoney(i.effectivePriceCents)}
                    onClick={() => setEditing(i)}
                    accessory="chevron"
                  />
                </SwipeActions>
              );
            })}
          </ListSection>
        ))
      )}

      <div className="flex justify-center">
        <Button
          variant="tinted"
          icon={<Plus size={18} />}
          onClick={() => setEditing("new")}
        >
          Add item
        </Button>
      </div>

      <MarkupMatrix tiers={tiers} />
      <CsvTools items={items} />

      <ItemSheet
        key={editing === "new" ? "new" : (editing?.id ?? "none")}
        item={editing}
        tiers={tiers}
        categories={categories}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ item sheet */

function ItemSheet({
  item,
  tiers,
  categories,
  onClose,
}: {
  item: PricebookItemRow | "new" | null;
  tiers: MarkupTier[];
  categories: string[];
  onClose: () => void;
}) {
  const it = item && item !== "new" ? item : null;
  const [kind, setKind] = useState<PricebookPick["kind"]>(
    it?.kind ?? "service",
  );
  const [cost, setCost] = useState<number | null>(it?.unitCostCents ?? null);
  const [price, setPrice] = useState<number | null>(it?.unitPriceCents ?? null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const isPart = kind === "part" || kind === "material";
  const matrixPrice = cost != null ? priceForCost(tiers, cost) : null;
  const effective = price ?? matrixPrice;

  const submit = (fd: FormData) =>
    start(async () => {
      const r = await savePricebookItem(fd);
      if (r.ok) {
        toast({ title: it ? "Item saved" : "Item added", tone: "success" });
        setDirty(false);
        onClose();
      } else {
        setErrors(r.fieldErrors ?? {});
        toast({ title: r.error, tone: "error" });
      }
    });

  return (
    <Sheet
      open={item != null}
      onOpenChange={(o) => !o && onClose()}
      title={it ? "Edit item" : "New item"}
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
          loading={pending}
          className="font-semibold"
          onClick={() => formRef.current?.requestSubmit()}
        >
          Save
        </Button>
      }
    >
      <form
        ref={formRef}
        action={submit}
        onChange={() => setDirty(true)}
        className="flex flex-col gap-4 px-[var(--gutter)] pb-8"
      >
        {it && <input type="hidden" name="id" value={it.id} />}
        <Select
          label="Kind"
          name="kind"
          value={kind}
          onChange={(e) =>
            setKind(e.currentTarget.value as PricebookPick["kind"])
          }
          options={KINDS}
        />
        <TextField
          label="Name"
          name="name"
          defaultValue={it?.name ?? ""}
          required
          maxLength={200}
          error={errors.name}
          autoComplete="off"
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Category"
            name="category"
            defaultValue={it?.category ?? ""}
            list="pricebook-categories"
            placeholder="e.g. Locks"
          />
          <TextField
            label="SKU"
            name="sku"
            defaultValue={it?.sku ?? ""}
            autoComplete="off"
          />
        </div>
        <datalist id="pricebook-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <div className="grid grid-cols-2 gap-3">
          <MoneyField
            label="Unit cost"
            name="unitCostCents"
            defaultCents={cost}
            onChangeCents={setCost}
            hint="Internal only"
          />
          <MoneyField
            label="Price"
            name="unitPriceCents"
            defaultCents={price}
            onChangeCents={setPrice}
            placeholder={
              matrixPrice != null ? (matrixPrice / 100).toFixed(2) : "0.00"
            }
            hint={
              price == null && matrixPrice != null
                ? "From markup matrix"
                : undefined
            }
            error={errors.unitPriceCents}
          />
        </div>
        {effective != null && cost != null && cost > 0 && (
          <p className="-mt-2 px-1 text-footnote text-label-2">
            Markup {markupPct(effective, cost)}% · margin{" "}
            {marginPct(effective, cost)}% · profit{" "}
            {formatMoney(effective - cost)}
          </p>
        )}
        <TextArea
          label="Description (shown to customers)"
          name="description"
          defaultValue={it?.description ?? ""}
          rows={2}
        />
        <div className="list-card">
          <ToggleRow
            title="Taxable"
            name="taxable"
            defaultChecked={it ? it.taxable : isPart}
          />
          {isPart && (
            <ToggleRow
              title="Special order"
              name="isSpecialOrder"
              defaultChecked={it?.isSpecialOrder}
            />
          )}
          <ToggleRow
            title="Active"
            name="active"
            defaultChecked={it ? it.active : true}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Warranty (days)"
            name="warrantyDays"
            inputMode="numeric"
            defaultValue={it?.warrantyDays ?? (isPart ? "" : "90")}
            error={errors.warrantyDays}
          />
          {isPart ? (
            <TextField
              label="Mfr. warranty (months)"
              name="manufacturerWarrantyMonths"
              inputMode="numeric"
              defaultValue={it?.manufacturerWarrantyMonths ?? ""}
            />
          ) : (
            <input type="hidden" name="manufacturerWarrantyMonths" value="" />
          )}
        </div>
        {isPart && (
          <TextField
            label="Vendor"
            name="vendor"
            defaultValue={it?.vendor ?? ""}
          />
        )}
        {it?.avgCostCents != null && (
          <p className="px-1 text-footnote text-label-2">
            Average stock cost {formatMoney(it.avgCostCents)} (from inventory)
          </p>
        )}
      </form>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ markup matrix */

function MarkupMatrix({ tiers: initial }: { tiers: MarkupTier[] }) {
  const [tiers, setTiers] = useState<MarkupTier[]>(initial);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(tiers) !== JSON.stringify(initial);
  const save = () =>
    start(async () => {
      const r = await saveMarkupTiers({ tiers });
      if (r.ok) {
        if (r.data) setTiers(r.data.tiers);
        toast({ title: "Markup matrix saved", tone: "success" });
      } else toast({ title: r.error, tone: "error" });
    });
  const update = (i: number, patch: Partial<MarkupTier>) =>
    setTiers((t) => t.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <ListSection
      header="Markup matrix"
      footer="Parts without a fixed price are priced from their cost. Example: a $12 part at 4× sells for $48 (75% margin)."
      trailing={
        dirty ? (
          <Button size="sm" variant="plain" loading={pending} onClick={save}>
            Save
          </Button>
        ) : null
      }
    >
      {tiers.map((t, i) => {
        const prevLt = i > 0 ? tiers[i - 1]?.lt : 0;
        const last = t.lt == null;
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: tiers are positional
            key={i}
            className="list-row flex min-h-11 flex-wrap items-center gap-2 px-4 py-2"
          >
            <span className="min-w-0 flex-1 text-body">
              {last
                ? `${formatMoney(prevLt ?? 0, { compactWhole: true })} and up`
                : `${formatMoney(prevLt ?? 0, { compactWhole: true })} – under`}
            </span>
            {!last && (
              <div className="w-28">
                <MoneyField
                  label="Upper bound"
                  hideLabel
                  defaultCents={t.lt}
                  onChangeCents={(c) =>
                    c != null && c > 0 && update(i, { lt: c })
                  }
                />
              </div>
            )}
            <div className="flex items-center gap-1">
              <span className="text-label-2">×</span>
              <input
                aria-label="Multiplier"
                inputMode="decimal"
                className="num h-11 w-16 rounded-control bg-fill-2 px-2 text-center text-body outline-none focus:shadow-[inset_0_0_0_2px_var(--accent)]"
                defaultValue={String(t.mult)}
                onChange={(e) => {
                  const v = Number(e.currentTarget.value);
                  if (Number.isFinite(v) && v >= 1) update(i, { mult: v });
                }}
              />
            </div>
            <span className="num w-20 text-right text-footnote text-label-2">
              {multToMarginPct(t.mult)}% margin
            </span>
            {!last && (
              <IconButton
                label="Remove tier"
                variant="plain"
                onClick={() => setTiers((x) => x.filter((_, j) => j !== i))}
              >
                <Trash2 size={18} />
              </IconButton>
            )}
          </div>
        );
      })}
      <ListRow
        title="Add tier"
        icon={<Plus size={17} />}
        iconStyle="tinted"
        onClick={() =>
          setTiers((t) => {
            const bounded = t.filter((x) => x.lt != null);
            const lastLt = bounded[bounded.length - 1]?.lt ?? 0;
            const open = t.find((x) => x.lt == null) ?? { lt: null, mult: 2 };
            return [
              ...bounded,
              { lt: lastLt + 5000, mult: open.mult + 0.5 },
              open,
            ];
          })
        }
      />
    </ListSection>
  );
}

/* ------------------------------------------------------------------ CSV */

function CsvTools({ items }: { items: PricebookItemRow[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [report, setReport] = useState<{
    created: number;
    updated: number;
    errors: { line: number; error: string }[];
  } | null>(null);

  const exportCsv = () => {
    const csv = toCsv(
      items.map((i) => ({
        sku: i.sku,
        name: i.name,
        kind: i.kind,
        category: i.category,
        description: i.description,
        unitCostCents: i.unitCostCents,
        unitPriceCents: i.unitPriceCents,
        taxable: i.taxable,
        isSpecialOrder: i.isSpecialOrder,
        vendor: i.vendor,
        warrantyDays: i.warrantyDays,
        manufacturerWarrantyMonths: i.manufacturerWarrantyMonths,
        active: i.active,
      })),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `price-book-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    start(async () => {
      if (f.size > 5 * 1024 * 1024) {
        toast({ title: "That file is larger than 5 MB.", tone: "error" });
        return;
      }
      const parsed = rowsFromCsv(parseCsv(await f.text()));
      if (parsed.rows.length === 0) {
        setReport({ created: 0, updated: 0, errors: parsed.errors });
        toast({ title: "Nothing to import", tone: "warning" });
        return;
      }
      const r = await importPricebookRows({ rows: parsed.rows });
      if (r.ok && r.data) {
        setReport({ ...r.data, errors: parsed.errors });
        toast({
          title: `Imported ${r.data.created + r.data.updated} items`,
          tone: "success",
        });
      } else if (!r.ok) toast({ title: r.error, tone: "error" });
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => onFile(e.currentTarget.files?.[0])}
      />
      <ListSection
        header="Import & export"
        footer="CSV columns: sku, name, kind, category, description, unit_cost, unit_price, taxable, special_order, vendor, warranty_days, mfr_warranty_months, active. Rows match by SKU, then by name."
      >
        <ListRow
          icon={<Download size={17} />}
          iconTone="green"
          title="Export CSV"
          detail={`${items.length} items`}
          onClick={exportCsv}
        />
        <ListRow
          icon={<FileUp size={17} />}
          iconTone="blue"
          title={pending ? "Importing…" : "Import CSV"}
          onClick={() => fileRef.current?.click()}
          disabled={pending}
        />
        {report && (
          <div className="px-4 py-3">
            <Banner
              tone={report.errors.length ? "warning" : "success"}
              title={`${report.created} added · ${report.updated} updated`}
            >
              {report.errors.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {report.errors.slice(0, 8).map((e) => (
                    <li key={`${e.line}-${e.error}`}>
                      Line {e.line}: {e.error}
                    </li>
                  ))}
                  {report.errors.length > 8 && (
                    <li>…and {report.errors.length - 8} more</li>
                  )}
                </ul>
              )}
            </Banner>
          </div>
        )}
      </ListSection>
    </>
  );
}
