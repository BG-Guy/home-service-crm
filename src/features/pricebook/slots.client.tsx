"use client";

import { BookOpen, Clock, PackageSearch, PencilLine, Plus } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { formatMoney } from "@/lib/money";
import { Button } from "@/ui/components/Button";
import { Chip } from "@/ui/components/Chip";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { SearchField } from "@/ui/components/SearchField";
import { Sheet } from "@/ui/components/Sheet";
import { SkeletonList } from "@/ui/components/Skeleton";
import { pricebookPickerFacets, searchPricebookItems } from "./actions";
import { QtyStepper, TypeTile } from "./components/ItemBits";
import type {
  PricebookFacets,
  PricebookPick,
  PricebookPickerProps,
} from "./contracts";

// Client UI slot S14 (BUILD_PLAN §5.1): searchable price-book sheet. Consumers:
// B6 AddPart sheet, B3 estimate/invoice/change-order builders. Calls only B3's own
// reads. Two modes: `onPick` hands back one item and closes (parts); with
// `onAddItem` (Quote to Paid E3) a tap adds the item at once, a second tap adds one
// more, picked rows show a − n + stepper and "Done · 3 items added" closes.
// Category chips wrap onto more lines (local to the picker), "Recent" first.

const KIND_LABEL: Record<PricebookPick["kind"], string> = {
  service: "Services",
  labor: "Labor",
  part: "Parts",
  material: "Materials",
  fee: "Fees",
};

const KIND_WORD: Record<PricebookPick["kind"], string> = {
  service: "service",
  labor: "labor",
  part: "part",
  material: "material",
  fee: "fee",
};

type Line = { pricebookItemId: string; lineId: string; qty: number };

/**
 * One-tap add: the quantities the picker shows (the document's lines, then each
 * tap), synced one call at a time per item so rapid taps coalesce and land in
 * order. A new line's id comes back from `onAddItem`, else from the refreshed
 * `picked` lines.
 */
function useOneTap({
  open,
  picked,
  onAddItem,
  onSetQty,
}: Pick<PricebookPickerProps, "picked" | "onAddItem" | "onSetQty"> & {
  open: boolean;
}) {
  const server = useMemo(() => {
    const m = new Map<string, Line>();
    for (const p of picked ?? [])
      if (!m.has(p.pricebookItemId)) m.set(p.pricebookItemId, p);
    return m;
  }, [picked]);
  const serverRef = useRef(server);
  serverRef.current = server;
  const [want, setWant] = useState<Record<string, number>>({});
  const [base, setBase] = useState<Record<string, number>>({});
  const wantRef = useRef<Record<string, number>>({});
  const ids = useRef<Record<string, string | null>>({});
  const have = useRef<Record<string, number>>({});
  const items = useRef<Record<string, PricebookPick>>({});
  const running = useRef(new Set<string>());
  const waiting = useRef(new Set<string>());

  useEffect(() => {
    if (!open) return;
    wantRef.current = {};
    ids.current = {};
    have.current = {};
    waiting.current.clear();
    setWant({});
    setBase({});
  }, [open]);

  // The latest callbacks: `run` reads refs only, so it never goes stale.
  const calls = useRef({ onAddItem, onSetQty });
  calls.current = { onAddItem, onSetQty };
  const serverQty = (id: string) => serverRef.current.get(id)?.qty ?? 0;
  const set = useCallback((id: string, q: number) => {
    wantRef.current = { ...wantRef.current, [id]: q };
    setWant(wantRef.current);
  }, []);

  const run = useCallback(
    async (item: PricebookPick) => {
      const id = item.id;
      const { onAddItem, onSetQty } = calls.current;
      if (!onAddItem || running.current.has(id) || waiting.current.has(id))
        return;
      running.current.add(id);
      try {
        for (;;) {
          const target = wantRef.current[id];
          if (target === undefined) break;
          const known = id in ids.current;
          const lineId = known
            ? ids.current[id]
            : (serverRef.current.get(id)?.lineId ?? null);
          const now =
            have.current[id] ??
            (known ? 0 : (serverRef.current.get(id)?.qty ?? 0));
          if (target === now) break;
          if (!lineId) {
            if (target <= 0) {
              have.current[id] = 0;
              break;
            }
            const r = await onAddItem(item, target);
            if (r === false) {
              set(id, now);
              break;
            }
            have.current[id] = target;
            if (typeof r === "string") ids.current[id] = r;
            else {
              // The id arrives with the refreshed lines (effect below).
              waiting.current.add(id);
              break;
            }
          } else {
            const ok = onSetQty ? await onSetQty(lineId, target) : false;
            if (!ok) {
              set(id, now);
              break;
            }
            have.current[id] = target;
            if (target <= 0) ids.current[id] = null;
          }
        }
      } finally {
        running.current.delete(id);
      }
    },
    [set],
  );

  // A line added without a known id: take it from the refreshed lines.
  useEffect(() => {
    for (const id of [...waiting.current]) {
      const s = server.get(id);
      if (!s) continue;
      waiting.current.delete(id);
      ids.current[id] = s.lineId;
      have.current[id] = s.qty;
      const it = items.current[id];
      if (it) void run(it);
    }
  }, [server, run]);

  const qtyOf = (id: string) => want[id] ?? server.get(id)?.qty ?? 0;
  const step = (item: PricebookPick, delta: number) => {
    const id = item.id;
    items.current[id] = item;
    const cur = wantRef.current[id] ?? serverQty(id);
    if (!(id in base)) setBase((b) => ({ ...b, [id]: cur }));
    set(id, Math.max(0, Math.round((cur + delta) * 1000) / 1000));
    void run(item);
  };
  const keys = new Set([...server.keys(), ...Object.keys(want)]);
  const pickedCount = [...keys].filter((k) => qtyOf(k) > 0).length;
  const added = Object.entries(want).reduce(
    (n, [k, q]) => n + Math.max(0, q - (base[k] ?? 0)),
    0,
  );
  return { qtyOf, step, pickedCount, added };
}

export function PricebookPicker({
  kinds,
  onPick,
  triggerLabel = "Price book",
  triggerVariant = "tinted",
  open: openProp,
  onOpenChange,
  title,
  picked,
  onAddItem,
  onSetQty,
  onCustom,
}: PricebookPickerProps) {
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const setOpen = (v: boolean) => {
    if (!controlled) setOpenState(v);
    onOpenChange?.(v);
  };
  const multi = !!onAddItem;
  const tap = useOneTap({ open, picked, onAddItem, onSetQty });
  const added = Math.round(tap.added);
  return (
    <>
      {!controlled && (
        <Button
          type="button"
          variant={triggerVariant}
          size="sm"
          icon={<BookOpen aria-hidden size={17} />}
          onClick={() => setOpen(true)}
        >
          {triggerLabel}
        </Button>
      )}
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={title ?? "Price book"}
        detents={["large"]}
        desktop="modal"
        leading={
          multi ? undefined : (
            <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          )
        }
        trailing={
          multi && tap.pickedCount > 0 ? (
            <span className="num pr-1 text-subhead text-label-2">
              {tap.pickedCount} picked
            </span>
          ) : undefined
        }
        footer={
          multi ? (
            <div className="px-[var(--gutter)] pb-2 pt-2">
              <Button size="lg" fullWidth onClick={() => setOpen(false)}>
                {added > 0
                  ? `Done · ${added} ${added === 1 ? "item" : "items"} added`
                  : "Done"}
              </Button>
            </div>
          ) : undefined
        }
      >
        {open && (
          <PickerBody
            kinds={kinds}
            multi={multi}
            qtyOf={tap.qtyOf}
            step={tap.step}
            onCustom={onCustom}
            onPick={(item) => {
              onPick(item);
              setOpen(false);
            }}
          />
        )}
      </Sheet>
    </>
  );
}

type ChipKey =
  | { t: "recent" }
  | { t: "all" }
  | { t: "category"; v: string }
  | { t: "kind"; v: PricebookPick["kind"] };

const sameChip = (a: ChipKey | null, b: ChipKey) =>
  !!a && a.t === b.t && (a as { v?: string }).v === (b as { v?: string }).v;

function PickerBody({
  kinds,
  multi,
  qtyOf,
  step,
  onPick,
  onCustom,
}: {
  kinds?: PricebookPick["kind"][];
  multi: boolean;
  qtyOf: (id: string) => number;
  step: (item: PricebookPick, delta: number) => void;
  onPick: (item: PricebookPick) => void;
  onCustom?: () => void;
}) {
  const allowed = useMemo(
    () => kinds ?? (Object.keys(KIND_LABEL) as PricebookPick["kind"][]),
    [kinds],
  );
  const [q, setQ] = useState("");
  const [facets, setFacets] = useState<PricebookFacets | null>(null);
  const [chip, setChip] = useState<ChipKey | null>(null);
  const [items, setItems] = useState<PricebookPick[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const seq = useRef(0);

  useEffect(() => {
    let live = true;
    pricebookPickerFacets({ kinds: allowed })
      .then((f) => {
        if (!live) return;
        setFacets(f);
        setChip(
          (c) => c ?? (f.recent.length > 0 ? { t: "recent" } : { t: "all" }),
        );
      })
      .catch(() => {
        if (!live) return;
        setFacets({ categories: [], recent: [] });
        setChip((c) => c ?? { t: "all" });
      });
    return () => {
      live = false;
    };
  }, [allowed]);

  useEffect(() => {
    if (!chip || chip.t === "recent") return;
    const n = ++seq.current;
    start(async () => {
      try {
        const res = await searchPricebookItems({
          q,
          kinds: chip.t === "kind" ? [chip.v] : allowed,
          category: chip.t === "category" ? chip.v : null,
        });
        if (n === seq.current) {
          setItems(res);
          setError(null);
        }
      } catch {
        if (n === seq.current) setError("Couldn't load the price book.");
      }
    });
  }, [q, chip, allowed]);

  const shown = useMemo(() => {
    if (chip?.t !== "recent") return items;
    const needle = q.trim().toLowerCase();
    return (facets?.recent ?? []).filter(
      (i) =>
        !needle ||
        i.name.toLowerCase().includes(needle) ||
        i.sku?.toLowerCase().startsWith(needle),
    );
  }, [chip, items, facets, q]);

  const groups = useMemo(() => {
    const m = new Map<string, PricebookPick[]>();
    for (const it of shown ?? []) {
      const key =
        chip?.t === "recent"
          ? "Recent"
          : it.category?.trim() || KIND_LABEL[it.kind];
      const list = m.get(key) ?? [];
      list.push(it);
      m.set(key, list);
    }
    return [...m.entries()];
  }, [shown, chip]);

  const cats = facets?.categories ?? [];
  const chips: { key: ChipKey; label: string }[] = [
    ...(facets?.recent.length
      ? [{ key: { t: "recent" } as ChipKey, label: "Recent" }]
      : []),
    { key: { t: "all" }, label: "All" },
    ...(cats.length > 0
      ? cats.map((c) => ({ key: { t: "category", v: c } as ChipKey, label: c }))
      : allowed.length > 1
        ? allowed.map((k) => ({
            key: { t: "kind", v: k } as ChipKey,
            label: KIND_LABEL[k],
          }))
        : []),
  ];

  return (
    <div className="flex flex-col gap-3 px-[var(--gutter)] pb-6">
      <SearchField
        placeholder="Search the price book"
        onSearch={setQ}
        showCancel={false}
        autoFocus={!multi}
      />
      {facets && chips.length > 1 && (
        // biome-ignore lint/a11y/useSemanticElements: a fieldset would add unwanted chrome
        <div
          role="group"
          aria-label="Filter the price book"
          className="flex flex-wrap gap-2"
        >
          {chips.map((c) => (
            <Chip
              key={`${c.key.t}:${(c.key as { v?: string }).v ?? ""}`}
              selected={sameChip(chip, c.key)}
              onClick={() => setChip(c.key)}
              icon={
                c.key.t === "recent" ? (
                  <Clock aria-hidden size={16} />
                ) : undefined
              }
            >
              {c.label}
            </Chip>
          ))}
        </div>
      )}
      {error ? (
        <p className="px-4 text-subhead text-danger">{error}</p>
      ) : shown === null || !facets ? (
        <SkeletonList rows={6} />
      ) : shown.length === 0 ? (
        <div className="list-card">
          <EmptyState
            compact
            icon={<PackageSearch size={40} />}
            title={q ? "No matches" : "Nothing here yet"}
            message={
              q
                ? "Try another word or SKU, or add a custom item instead."
                : "Add services, parts and fees in Settings → Price book."
            }
          />
        </div>
      ) : (
        <div
          className="flex flex-col gap-[var(--section-gap)] transition-opacity"
          style={{ opacity: pending ? 0.6 : 1 }}
          aria-busy={pending}
        >
          {groups.map(([group, list]) =>
            multi ? (
              <section key={group} aria-label={group}>
                {groups.length > 1 && (
                  <h3 className="px-1 pb-1.5 text-footnote font-semibold text-label-2">
                    {group}
                  </h3>
                )}
                <ul className="list-card">
                  {list.map((it) => (
                    <TapRow
                      key={it.id}
                      item={it}
                      qty={qtyOf(it.id)}
                      onStep={(d) => step(it, d)}
                    />
                  ))}
                </ul>
              </section>
            ) : (
              <ListSection key={group} header={group}>
                {list.map((it) => (
                  <ListRow
                    key={it.id}
                    title={it.name}
                    subtitle={
                      [
                        it.sku,
                        it.isSpecialOrder ? "Special order" : null,
                        it.taxable ? "Taxable" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || KIND_LABEL[it.kind]
                    }
                    detail={formatMoney(it.unitPriceCents)}
                    onClick={() => onPick(it)}
                    accessory="none"
                  />
                ))}
              </ListSection>
            ),
          )}
        </div>
      )}
      {multi && onCustom ? (
        <div className="flex items-center justify-between gap-3 px-1">
          <Button
            variant="plain"
            size="sm"
            icon={<PencilLine aria-hidden size={16} />}
            onClick={onCustom}
          >
            Custom item
          </Button>
          <span className="text-footnote text-label-2">
            Name, price, quantity
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** A price-book row in one-tap mode: tap adds one; picked rows show − n +. */
function TapRow({
  item: it,
  qty,
  onStep,
}: {
  item: PricebookPick;
  qty: number;
  onStep: (delta: number) => void;
}) {
  const sub = [
    formatMoney(it.unitPriceCents),
    it.isSpecialOrder ? "special order" : KIND_WORD[it.kind],
  ].join(" · ");
  return (
    <li className="list-row relative flex min-h-[68px] items-center gap-3 px-4 py-2.5">
      <TypeTile type={it.kind} size={48} />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onStep(1)}
          aria-label={
            qty > 0 ? `Add one more ${it.name} (${qty} now)` : `Add ${it.name}`
          }
          className="box-hit block text-left text-body font-medium text-label outline-none [overflow-wrap:anywhere]"
        >
          {it.name}
        </button>
        <p className="num text-subhead text-label-2">{sub}</p>
      </div>
      {qty > 0 ? (
        <QtyStepper
          value={qty}
          min={0}
          onChange={(n) => onStep(n - qty)}
          label={it.name}
          className="relative z-[1]"
        />
      ) : (
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-fill-2 text-accent-text"
        >
          <Plus size={20} strokeWidth={2.4} />
        </span>
      )}
    </li>
  );
}
