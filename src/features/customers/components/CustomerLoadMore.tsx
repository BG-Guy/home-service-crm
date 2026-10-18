"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ListSection } from "@/ui/components/List";
import { Spinner } from "@/ui/components/Spinner";
import { loadMoreCustomers } from "../actions";
import type { CustomerListItem } from "../contracts";
import { CustomerRow } from "./CustomerRow";

/** Appends the next keyset pages when the sentinel scrolls into view (or on tap). */
export function CustomerLoadMore({
  filter,
  cursor,
  activeId,
  compact,
}: {
  filter: { q?: string; type?: string; tag?: string; flag?: string };
  cursor: string;
  activeId?: string;
  compact?: boolean;
}) {
  const [items, setItems] = useState<CustomerListItem[]>([]);
  const [next, setNext] = useState<string | null>(cursor);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLButtonElement>(null);

  const load = () => {
    if (!next || pending) return;
    start(async () => {
      const r = await loadMoreCustomers({ ...filter, cursor: next });
      setItems((prev) => [...prev, ...r.items]);
      setNext(r.nextCursor);
    });
  };

  useEffect(() => {
    const el = ref.current;
    if (!el || !next) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) load();
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  });

  return (
    <>
      {items.length > 0 && (
        <ListSection>
          {items.map((c) => (
            <CustomerRow
              key={c.id}
              c={c}
              q={filter.q}
              active={activeId === c.id}
              compact={compact}
            />
          ))}
        </ListSection>
      )}
      {next && (
        <button
          ref={ref}
          type="button"
          onClick={load}
          className="pressable mx-auto flex min-h-11 items-center gap-2 rounded-pill bg-fill-2 px-5 text-subhead font-semibold text-accent-text"
        >
          {pending ? <Spinner size={16} /> : null}
          {pending ? "Loading…" : "Load more"}
        </button>
      )}
    </>
  );
}
