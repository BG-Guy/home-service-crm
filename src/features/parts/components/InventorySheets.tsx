"use client";

import {
  ArrowLeftRight,
  ClipboardList,
  SlidersHorizontal,
  Truck,
} from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { Select, TextArea, TextField } from "@/ui/components/Field";
import { IconButton } from "@/ui/components/IconButton";
import { MoneyField } from "@/ui/components/MoneyField";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import {
  moveStock,
  requestTruckRestock,
  setParLevel,
  submitCount,
  syncLocations,
} from "../actions";

type Loc = { id: string; name: string };
type Item = {
  id: string;
  name: string;
  sku: string | null;
  cost: number | null;
};

const num = (v: string) => (v.trim() === "" ? null : Number(v));

/** Receive / transfer / adjust / return. */
export function MoveStockButton({
  locations,
  items,
  currentId,
}: {
  locations: Loc[];
  items: Item[];
  currentId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<
    "receive" | "transfer" | "adjust" | "return"
  >("receive");
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const [qty, setQty] = useState("1");
  const [from, setFrom] = useState(
    locations.find((l) => l.name === "Warehouse")?.id ?? locations[0]?.id ?? "",
  );
  const [to, setTo] = useState(currentId ?? locations[0]?.id ?? "");
  const [cost, setCost] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const opts = locations.map((l) => ({ value: l.id, label: l.name }));
  const item = items.find((i) => i.id === itemId);

  const save = () =>
    start(async () => {
      setError(null);
      const q = Number(qty);
      const r = await moveStock({
        kind,
        pricebookItemId: itemId,
        qty: kind === "adjust" ? q : Math.abs(q),
        fromLocationId:
          kind === "transfer" ? from : kind === "adjust" ? null : null,
        toLocationId:
          kind === "transfer" ||
          kind === "receive" ||
          kind === "return" ||
          kind === "adjust"
            ? to
            : null,
        unitCostCents: kind === "receive" ? (cost ?? item?.cost ?? null) : null,
        note: note || null,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast({ title: "Stock updated", tone: "success" });
      setOpen(false);
      setQty("1");
      setNote("");
    });

  return (
    <>
      <Button
        size="sm"
        variant="tinted"
        icon={<ArrowLeftRight size={17} aria-hidden />}
        onClick={() => setOpen(true)}
      >
        Move stock
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Move stock"
        detents={["large"]}
        leading={
          <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        }
        footer={
          <Button
            size="lg"
            fullWidth
            loading={pending}
            disabled={!itemId || !Number(qty)}
            onClick={save}
          >
            Save
          </Button>
        }
      >
        <div className="flex flex-col gap-4 pb-6 pt-1">
          <SegmentedControl
            label="Move type"
            value={kind}
            onChange={setKind}
            segments={[
              { value: "receive", label: "Receive" },
              { value: "transfer", label: "Transfer" },
              { value: "adjust", label: "Adjust" },
              { value: "return", label: "Return" },
            ]}
          />
          <Select
            label="Item"
            value={itemId}
            onChange={(e) => setItemId(e.currentTarget.value)}
            options={items.map((i) => ({
              value: i.id,
              label: i.sku ? `${i.name} · ${i.sku}` : i.name,
            }))}
          />
          <TextField
            label={kind === "adjust" ? "Change (+ or −)" : "Quantity"}
            inputMode="decimal"
            value={qty}
            onChange={(e) =>
              setQty(e.currentTarget.value.replace(/[^\d.-]/g, ""))
            }
          />
          {kind === "transfer" && (
            <Select
              label="From"
              value={from}
              onChange={(e) => setFrom(e.currentTarget.value)}
              options={opts}
            />
          )}
          <Select
            label={
              kind === "transfer"
                ? "To"
                : kind === "adjust"
                  ? "Location"
                  : kind === "return"
                    ? "Back into"
                    : "Into"
            }
            value={to}
            onChange={(e) => setTo(e.currentTarget.value)}
            options={opts}
          />
          {kind === "receive" && (
            <MoneyField
              label="Unit cost"
              valueCents={cost ?? item?.cost ?? null}
              onChangeCents={setCost}
              hint="Updates the item's average cost"
            />
          )}
          <TextArea
            label="Note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            placeholder={
              kind === "adjust" ? "Why? (damaged, found…)" : "Optional"
            }
          />
          {kind === "transfer" && (
            <p className="text-footnote text-label-2">
              A transfer into a truck closes its open restock request.
            </p>
          )}
          {error && (
            <p role="alert" className="text-footnote text-danger">
              {error}
            </p>
          )}
        </div>
      </Sheet>
    </>
  );
}

/** Par levels (min/max) for one item at one location. */
export function ParButton({
  locationId,
  item,
  min,
  max,
}: {
  locationId: string;
  item: { id: string; name: string };
  min: number | null;
  max: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [lo, setLo] = useState(min == null ? "" : String(min));
  const [hi, setHi] = useState(max == null ? "" : String(max));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <IconButton
        label={`Par for ${item.name}`}
        size={36}
        variant="gray"
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal size={17} aria-hidden />
      </IconButton>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Par level"
        detents={["content"]}
        footer={
          <Button
            size="lg"
            fullWidth
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await setParLevel({
                  locationId,
                  pricebookItemId: item.id,
                  minQty: num(lo),
                  maxQty: num(hi),
                });
                if (!r.ok) {
                  setError(r.fieldErrors?.maxQty?.[0] ?? r.error);
                  return;
                }
                toast({ title: "Par saved", tone: "success" });
                setOpen(false);
              })
            }
          >
            Save
          </Button>
        }
      >
        <div className="flex flex-col gap-3 pb-6 pt-1">
          <p className="text-subhead text-label-2">{item.name}</p>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Min (reorder at)"
              inputMode="decimal"
              value={lo}
              onChange={(e) => setLo(e.currentTarget.value)}
            />
            <TextField
              label="Max (fill to)"
              inputMode="decimal"
              value={hi}
              onChange={(e) => setHi(e.currentTarget.value)}
              error={error}
            />
          </div>
        </div>
      </Sheet>
    </>
  );
}

/** Monthly cycle count: enter counted quantities; variances are recorded (no deduction from techs). */
export function CountButton({
  locationId,
  locationName,
  levels,
}: {
  locationId: string;
  locationName: string;
  levels: { itemId: string; name: string; onHand: number }[];
}) {
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        size="sm"
        variant="gray"
        icon={<ClipboardList size={17} aria-hidden />}
        onClick={() => setOpen(true)}
      >
        Count
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={`Count ${locationName}`}
        detents={["large"]}
        dirty={Object.keys(counts).length > 0}
        leading={
          <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        }
        footer={
          <Button
            size="lg"
            fullWidth
            loading={pending}
            disabled={Object.keys(counts).length === 0}
            onClick={() =>
              start(async () => {
                const r = await submitCount({
                  locationId,
                  counts: Object.entries(counts)
                    .filter(([, v]) => v.trim() !== "")
                    .map(([pricebookItemId, v]) => ({
                      pricebookItemId,
                      counted: Number(v),
                    })),
                });
                if (!r.ok) {
                  toast({
                    title: "Couldn't save the count",
                    message: r.error,
                    tone: "error",
                  });
                  return;
                }
                const n = r.data?.variances.length ?? 0;
                toast({
                  title: n
                    ? `${n} variance${n === 1 ? "" : "s"} recorded`
                    : "Count matches",
                  tone: "success",
                });
                setCounts({});
                setOpen(false);
              })
            }
          >
            Save count
          </Button>
        }
      >
        <div className="flex flex-col gap-2 pb-6 pt-1">
          <p className="text-footnote text-label-2">
            Leave a row empty to skip it. Differences are logged; nothing is
            charged to anyone.
          </p>
          {levels.map((l) => (
            <div
              key={l.itemId}
              className="flex items-center justify-between gap-3 border-b border-sep py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-body">{l.name}</p>
                <p className="text-footnote text-label-2">System: {l.onHand}</p>
              </div>
              <TextField
                label={`Counted ${l.name}`}
                hideLabel
                inputMode="decimal"
                className="w-24"
                placeholder={String(l.onHand)}
                value={counts[l.itemId] ?? ""}
                onChange={(e) => {
                  const v = e.currentTarget.value.replace(/[^\d.]/g, "");
                  setCounts((c) => ({ ...c, [l.itemId]: v }));
                }}
              />
            </div>
          ))}
        </div>
      </Sheet>
    </>
  );
}

/** Tech: "Request restock" for their truck (items below par → office task). */
export function RequestRestockButton({
  locationId,
  belowPar,
}: {
  locationId: string | null;
  belowPar: number;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        size="sm"
        variant={belowPar ? "filled" : "tinted"}
        icon={<Truck size={17} aria-hidden />}
        onClick={() => setOpen(true)}
      >
        Request restock
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Request restock"
        detents={["content"]}
        footer={
          <Button
            size="lg"
            fullWidth
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await requestTruckRestock({
                  locationId,
                  note: note || null,
                });
                if (!r.ok) {
                  toast({
                    title: "Couldn't send",
                    message: r.error,
                    tone: "error",
                  });
                  return;
                }
                toast({
                  title: "Restock requested",
                  message: `${r.data?.items ?? 0} items below par sent to the office.`,
                  tone: "success",
                });
                setOpen(false);
              })
            }
          >
            Send to office
          </Button>
        }
      >
        <div className="flex flex-col gap-3 pb-6 pt-1">
          <p className="text-subhead text-label-2">
            {belowPar
              ? `${belowPar} item${belowPar === 1 ? " is" : "s are"} below par. The office will refill your truck to max.`
              : "Everything is at par. Add a note for anything else you need."}
          </p>
          <TextArea
            label="Note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            placeholder="Optional"
          />
        </div>
      </Sheet>
    </>
  );
}

export function SyncLocationsButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="plain"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await syncLocations({});
          toast(
            r.ok
              ? { title: "Locations updated", tone: "success" }
              : { title: "Couldn't update", message: r.error, tone: "error" },
          );
        })
      }
    >
      Add vehicle locations
    </Button>
  );
}
