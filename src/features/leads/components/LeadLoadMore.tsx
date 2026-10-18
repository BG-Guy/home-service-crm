"use client";

import { useState, useTransition } from "react";
import { Spinner } from "@/ui/components/Spinner";
import { loadMoreLeads } from "../actions";
import type { LeadListItem } from "../contracts";
import type { LeadFilter } from "../queries";
import { LeadCard } from "./LeadCard";

/** "Load more" for the inbox (offset pages; the inbox is SLA-sorted, not keyset-friendly). */
export function LeadLoadMore({
  filter,
  offset,
  viewerId,
  canEdit,
  lostReasons,
}: {
  filter: LeadFilter;
  offset: number;
  viewerId: string;
  canEdit: boolean;
  lostReasons: string[];
}) {
  const [items, setItems] = useState<LeadListItem[]>([]);
  const [more, setMore] = useState(true);
  const [pending, start] = useTransition();
  return (
    <>
      {items.map((l) => (
        <LeadCard
          key={l.id}
          lead={l}
          viewerId={viewerId}
          canEdit={canEdit}
          lostReasons={lostReasons}
        />
      ))}
      {more && (
        <button
          type="button"
          onClick={() =>
            start(async () => {
              const r = await loadMoreLeads({
                ...filter,
                offset: offset + items.length,
              });
              setItems((p) => [...p, ...r.items]);
              setMore(r.hasMore);
            })
          }
          className="pressable mx-auto flex min-h-11 items-center gap-2 rounded-pill bg-fill-2 px-5 text-subhead font-semibold text-accent-text"
        >
          {pending ? <Spinner size={16} /> : null}
          {pending ? "Loading…" : "Load more"}
        </button>
      )}
    </>
  );
}
