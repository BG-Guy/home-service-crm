"use client";

import { Camera, Check, Package, Receipt, Truck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PricebookPick } from "@/features/pricebook/contracts";
import { PricebookPicker } from "@/features/pricebook/slots.client";
import { newId } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { CameraButton } from "@/ui/components/CameraButton";
import { DateField, TextField } from "@/ui/components/Field";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyField } from "@/ui/components/MoneyField";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { SkeletonList } from "@/ui/components/Skeleton";
import { Stepper } from "@/ui/components/Stepper";
import { toast } from "@/ui/components/Toast";
import { Toggle } from "@/ui/components/Toggle";
import {
  fe,
  submitOffline,
  toastQueued,
} from "../../payroll/components/submit";
import { addPartContext } from "../actions";
import type { AddPartButtonProps } from "../contracts";
import { markupMargin, priceForCostTiers } from "../rules";

type Source = "stock" | "pricebook" | "tech_paid" | "company_card";
type Ctx = Awaited<ReturnType<typeof addPartContext>>;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * S39 sheet: truck stock, price book, "I bought it" (tech-paid, receipt photo) and
 * company card (receipt required). Special order adds a PO line + deposit request.
 */
export default function AddPartSheet({
  jobId,
  mode = "any",
  open,
  onOpenChange,
}: AddPartButtonProps & { open: boolean; onOpenChange: (o: boolean) => void }) {
  const special = mode === "special_order";
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [source, setSource] = useState<Source>(
    mode === "tech_paid"
      ? "tech_paid"
      : mode === "company_card"
        ? "company_card"
        : mode === "stock"
          ? "stock"
          : "pricebook",
  );
  const [clientId, setClientId] = useState(newId);
  const [pick, setPick] = useState<PricebookPick | null>(null);
  const [stockItem, setStockItem] = useState<Ctx["stock"][number] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [name, setName] = useState("");
  const [qty, setQty] = useState(1);
  const [paidCents, setPaidCents] = useState<number | null>(null);
  const [priceCents, setPriceCents] = useState<number | null>(null);
  const [priceTouched, setPriceTouched] = useState(false);
  const [vendor, setVendor] = useState("");
  const [purchasedOn, setPurchasedOn] = useState(today);
  const [fromPo, setFromPo] = useState(special);
  const [receipt, setReceipt] = useState<{
    clientId: string;
    mediaId?: string;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || ctx) return;
    addPartContext(jobId)
      .then((c) => {
        setCtx(c);
        if (mode === "any" && c.inventoryOn && c.stock.length > 0)
          setSource("stock");
      })
      .catch(() => setLoadError("Couldn't load parts. Check your connection."));
  }, [open, ctx, jobId, mode]);

  const reset = () => {
    setClientId(newId());
    setPick(null);
    setStockItem(null);
    setName("");
    setQty(1);
    setPaidCents(null);
    setPriceCents(null);
    setPriceTouched(false);
    setVendor("");
    setReceipt(null);
    setErrors(undefined);
    setError(null);
  };

  const paidOnReceipt = source === "tech_paid" || source === "company_card";
  const unitCost = paidOnReceipt
    ? paidCents != null && qty > 0
      ? Math.round(paidCents / qty)
      : null
    : source === "stock"
      ? (stockItem?.costCents ?? null)
      : (pick?.unitCostCents ?? null);
  const suggested = useMemo(() => {
    if (source === "stock") return stockItem?.priceCents ?? null;
    if (pick) return pick.unitPriceCents;
    if (unitCost != null && ctx)
      return priceForCostTiers(ctx.markupTiers, unitCost);
    return null;
  }, [source, stockItem, pick, unitCost, ctx]);
  const unitPrice = priceTouched ? priceCents : suggested;
  const mm =
    unitCost != null && unitPrice != null
      ? markupMargin(unitCost, unitPrice)
      : null;
  const itemName =
    source === "stock" ? (stockItem?.name ?? "") : (pick?.name ?? name);
  const receiptNeeded =
    source === "company_card" ||
    (source === "tech_paid" &&
      (paidCents ?? 0) > (ctx?.receiptRequiredOverCents ?? 0));
  const ready =
    !!itemName.trim() &&
    qty > 0 &&
    unitPrice != null &&
    (!paidOnReceipt || (paidCents ?? 0) > 0) &&
    (source !== "company_card" || !!receipt);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setPending(true);
    setError(null);
    const lineSource =
      source === "stock"
        ? "company_stock"
        : source === "pricebook"
          ? fromPo
            ? "company_po"
            : "company_stock"
          : source === "tech_paid"
            ? "tech_purchased"
            : "company_card";
    const r = await submitOffline<{
      status: string | null;
      depositRequired: boolean;
    }>("parts.addPart", {
      jobId,
      source: lineSource,
      pricebookItemId:
        source === "stock" ? (stockItem?.itemId ?? null) : (pick?.id ?? null),
      name: itemName.trim(),
      qty,
      unitCostCents: paidOnReceipt ? null : unitCost,
      unitPriceCents: unitPrice,
      receiptTotalCents: paidOnReceipt ? paidCents : null,
      vendor: paidOnReceipt ? vendor || null : null,
      purchasedOn: paidOnReceipt ? purchasedOn : null,
      receiptMediaId: receipt?.mediaId ?? null,
      receiptClientId: receipt?.clientId ?? null,
      specialOrder: special || !!pick?.isSpecialOrder,
      warrantyDays: pick?.warrantyDays ?? null,
      manufacturerWarrantyMonths: pick?.manufacturerWarrantyMonths ?? null,
      clientId,
    });
    setPending(false);
    if (!r.ok) {
      setErrors(r.fieldErrors);
      setError(r.error);
      return;
    }
    if (r.queued) toastQueued("Part");
    else
      toast({
        title: special ? "Part ordered" : "Part added",
        message: r.data?.depositRequired
          ? "A deposit request was created for the special-order part."
          : r.data?.status === "pending"
            ? "Your receipt is waiting for approval."
            : r.data?.status === "approved" && source === "tech_paid"
              ? "Receipt approved: the reimbursement goes on your next statement."
              : undefined,
        tone: "success",
      });
    onOpenChange(false);
    reset();
  };

  const segments = [
    ...(ctx?.inventoryOn ? [{ value: "stock" as const, label: "Truck" }] : []),
    { value: "pricebook" as const, label: "Price book" },
    { value: "tech_paid" as const, label: "I bought it" },
    { value: "company_card" as const, label: "Co. card" },
  ];
  const formId = `add-part-${clientId}`;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={special ? "Order part" : "Add part"}
      detents={["large"]}
      dirty={!!itemName || paidCents != null}
      leading={
        <Button variant="plain" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      }
      footer={
        <Button
          type="submit"
          form={formId}
          size="lg"
          fullWidth
          loading={pending}
          disabled={!ready}
        >
          {special ? "Order part" : "Add to job"}
        </Button>
      }
    >
      <form
        id={formId}
        onSubmit={submit}
        className="flex flex-col gap-4 pb-6 pt-1"
      >
        {loadError && <Banner tone="error">{loadError}</Banner>}
        {ctx?.invoiceIssued && (
          <Banner tone="warning" title="Invoice already issued">
            New parts need an invoice revision. Ask the office to revise it.
          </Banner>
        )}
        {!special && (
          <SegmentedControl
            label="Where the part came from"
            segments={segments}
            value={source}
            onChange={(v) => {
              setSource(v);
              setPriceTouched(false);
            }}
          />
        )}

        {source === "stock" &&
          (!ctx ? (
            <SkeletonList rows={4} />
          ) : ctx.stock.length === 0 ? (
            <p className="rounded-card bg-fill-2 px-4 py-6 text-center text-subhead text-label-2">
              {ctx.locationName
                ? `Nothing in stock on ${ctx.locationName}.`
                : "No truck stock is assigned to you."}
            </p>
          ) : (
            <ListSection header={ctx.locationName ?? "Truck stock"}>
              {ctx.stock.map((s) => (
                <ListRow
                  key={s.itemId}
                  icon={<Truck size={18} aria-hidden />}
                  title={s.name}
                  subtitle={`${s.onHand} on truck${s.sku ? ` · ${s.sku}` : ""}`}
                  detail={formatMoney(s.priceCents)}
                  accessory={stockItem?.itemId === s.itemId ? "check" : "none"}
                  onClick={() => setStockItem(s)}
                />
              ))}
            </ListSection>
          ))}

        {source !== "stock" && (
          <div className="flex flex-col gap-3">
            {pick ? (
              <div className="flex items-center justify-between gap-3 rounded-card bg-fill-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-body font-medium">{pick.name}</p>
                  <p className="text-footnote text-label-2">
                    {pick.sku ? `${pick.sku} · ` : ""}
                    {formatMoney(pick.unitPriceCents)}
                    {pick.isSpecialOrder ? " · special order" : ""}
                  </p>
                </div>
                <Button variant="plain" size="sm" onClick={() => setPick(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <>
                <Button
                  variant="tinted"
                  icon={<Package size={18} aria-hidden />}
                  onClick={() => setPickerOpen(true)}
                >
                  Choose from price book
                </Button>
                {source !== "pricebook" && (
                  <TextField
                    label="Or describe the part"
                    placeholder="e.g. 3/4 in. ball valve"
                    value={name}
                    onChange={(e) => setName(e.currentTarget.value)}
                    error={fe(errors, "name")}
                  />
                )}
              </>
            )}
            <PricebookPicker
              kinds={["part", "material"]}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              onPick={(p) => {
                setPick(p);
                setPickerOpen(false);
                setPriceTouched(false);
                if (p.isSpecialOrder) setFromPo(true);
              }}
            />
          </div>
        )}

        <Stepper
          label="Quantity"
          value={qty}
          min={1}
          max={999}
          onChange={setQty}
        />

        {paidOnReceipt && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <MoneyField
                label={source === "tech_paid" ? "What you paid" : "Card charge"}
                valueCents={paidCents}
                onChangeCents={setPaidCents}
                hint="Receipt total"
                error={fe(errors, "receiptTotalCents")}
              />
              <DateField
                label="Date"
                value={purchasedOn}
                onChange={(e) => setPurchasedOn(e.currentTarget.value)}
              />
            </div>
            <TextField
              label="Store"
              placeholder="e.g. Home Depot"
              value={vendor}
              onChange={(e) => setVendor(e.currentTarget.value)}
            />
            <div className="flex flex-col gap-2">
              <CameraButton
                kind="receipt"
                tag="receipt"
                jobId={jobId}
                label={receipt ? "Retake receipt" : "Photo of receipt"}
                multiple={false}
                icon={
                  receipt?.mediaId ? (
                    <Check size={18} aria-hidden />
                  ) : (
                    <Camera size={18} aria-hidden />
                  )
                }
                onQueued={(r) =>
                  setReceipt({ clientId: r.clientId, mediaId: r.mediaId })
                }
                onUploaded={(r) =>
                  setReceipt({ clientId: r.clientId, mediaId: r.mediaId })
                }
                onError={(e) =>
                  toast({
                    title: "Photo failed",
                    message: e.message,
                    tone: "error",
                  })
                }
              />
              <p className="flex items-center gap-1.5 text-footnote text-label-2">
                <Receipt size={14} aria-hidden />
                {receipt
                  ? receipt.mediaId
                    ? "Receipt attached."
                    : "Receipt saved, uploading…"
                  : receiptNeeded
                    ? "A receipt photo is required."
                    : "Add the receipt now or later from Finish my day."}
              </p>
              {fe(errors, "receiptMediaId") && (
                <p role="alert" className="text-footnote text-danger">
                  {fe(errors, "receiptMediaId")}
                </p>
              )}
            </div>
          </div>
        )}

        {source === "pricebook" && (
          <Toggle
            label={
              fromPo ? "Ordered from the supplier (PO)" : "From company stock"
            }
            checked={fromPo}
            onChange={(e) => setFromPo(e.currentTarget.checked)}
          />
        )}

        <MoneyField
          label="Price to customer (each)"
          valueCents={unitPrice}
          onChangeCents={(c) => {
            setPriceTouched(true);
            setPriceCents(c);
          }}
          hint={
            mm?.markupPct != null && mm.marginPct != null
              ? `Markup ${Math.round(mm.markupPct)}% · margin ${Math.round(mm.marginPct)}%`
              : paidOnReceipt
                ? "Suggested from the markup table"
                : undefined
          }
          error={fe(errors, "unitPriceCents")}
        />
        {unitPrice != null && qty > 0 && (
          <p className="text-right text-subhead text-label-2">
            Line total{" "}
            <span className="num font-semibold text-label">
              {formatMoney(unitPrice * qty)}
            </span>
          </p>
        )}
        {error && !errors && (
          <p role="alert" className="text-footnote text-danger">
            {error}
          </p>
        )}
      </form>
    </Sheet>
  );
}
