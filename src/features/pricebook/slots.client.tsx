"use client";

import { BookOpen, PackageSearch } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import { Button } from "@/ui/components/Button";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { SearchField } from "@/ui/components/SearchField";
import { Sheet } from "@/ui/components/Sheet";
import { SkeletonList } from "@/ui/components/Skeleton";
import { searchPricebookItems } from "./actions";
import type { PricebookPick, PricebookPickerProps } from "./contracts";

// Client UI slot S14 (BUILD_PLAN §5.1): searchable price-book sheet. Consumers:
// B6 AddPart sheet, B3 estimate/invoice/change-order builders. Calls only B3's own
// search function; `onPick` hands back a PricebookPick and closes the sheet.

const KIND_LABEL: Record<PricebookPick["kind"], string> = {
  service: "Services",
  labor: "Labor",
  part: "Parts",
  material: "Materials",
  fee: "Fees",
};

export function PricebookPicker({
  kinds,
  onPick,
  triggerLabel = "Price book",
  triggerVariant = "tinted",
  open: openProp,
  onOpenChange,
}: PricebookPickerProps) {
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const setOpen = (v: boolean) => {
    if (!controlled) setOpenState(v);
    onOpenChange?.(v);
  };
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
        title="Price book"
        detents={["large"]}
        desktop="modal"
        leading={
          <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        }
      >
        {open && (
          <PickerBody
            kinds={kinds}
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

function PickerBody({
  kinds,
  onPick,
}: {
  kinds?: PricebookPick["kind"][];
  onPick: (item: PricebookPick) => void;
}) {
  const allowed = useMemo(
    () => kinds ?? (Object.keys(KIND_LABEL) as PricebookPick["kind"][]),
    [kinds],
  );
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<PricebookPick["kind"] | "all">("all");
  const [items, setItems] = useState<PricebookPick[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const seq = useRef(0);

  useEffect(() => {
    const n = ++seq.current;
    start(async () => {
      try {
        const res = await searchPricebookItems({
          q,
          kinds: kind === "all" ? allowed : [kind],
        });
        if (n === seq.current) {
          setItems(res);
          setError(null);
        }
      } catch {
        if (n === seq.current) setError("Couldn't load the price book.");
      }
    });
  }, [q, kind, allowed]);

  const groups = useMemo(() => {
    const m = new Map<string, PricebookPick[]>();
    for (const it of items ?? []) {
      const key = it.category?.trim() || KIND_LABEL[it.kind];
      const list = m.get(key) ?? [];
      list.push(it);
      m.set(key, list);
    }
    return [...m.entries()];
  }, [items]);

  return (
    <div className="flex flex-col gap-3 px-[var(--gutter)] pb-6">
      <SearchField
        placeholder="Search items, SKUs, categories"
        onSearch={setQ}
        showCancel={false}
        autoFocus
      />
      {allowed.length > 1 && (
        <ChipRow label="Filter by kind">
          <Chip selected={kind === "all"} onClick={() => setKind("all")}>
            All
          </Chip>
          {allowed.map((k) => (
            <Chip key={k} selected={kind === k} onClick={() => setKind(k)}>
              {KIND_LABEL[k]}
            </Chip>
          ))}
        </ChipRow>
      )}
      {error ? (
        <p className="px-4 text-subhead text-danger">{error}</p>
      ) : items === null ? (
        <SkeletonList rows={6} />
      ) : items.length === 0 ? (
        <div className="list-card">
          <EmptyState
            compact
            icon={<PackageSearch size={40} />}
            title={q ? "No matches" : "Your price book is empty"}
            message={
              q
                ? "Try another word or SKU, or add a custom line instead."
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
          {groups.map(([group, list]) => (
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
          ))}
        </div>
      )}
    </div>
  );
}
