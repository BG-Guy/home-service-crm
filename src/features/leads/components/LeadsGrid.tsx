"use client";

import {
  type CSSProperties,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { Spinner } from "@/ui/components/Spinner";
import { cx } from "@/ui/cx";
import { loadMoreLeads } from "../actions";
import type { LeadBoxData } from "../contracts";
import type { LeadFilter } from "../queries";
import { useInboxView } from "./inbox-state";
import { LeadBox } from "./LeadBox";
import { useLeadCard } from "./lead-env";

/**
 * The inbox grid (leads-flow item 1): phones show the 1 or 2 columns picked with
 * the switch; tablets and desktop fit as many boxes as there's room for. Boxes
 * are seeded into the card provider, so a card (or a map pin) opens with its
 * TL;DR at once. "Load more" pages by offset (the inbox is SLA-sorted).
 */
export function LeadsGrid({
  items,
  hasMore,
  filter,
}: {
  items: LeadBoxData[];
  hasMore: boolean;
  filter: LeadFilter;
}) {
  const card = useLeadCard();
  const { cols } = useInboxView();
  const [more, setMore] = useState<LeadBoxData[]>([]);
  const [moreLeft, setMoreLeft] = useState(hasMore);
  const [pending, start] = useTransition();
  const all = useMemo(() => {
    const seen = new Set(items.map((i) => i.id));
    return [...items, ...more.filter((m) => !seen.has(m.id))];
  }, [items, more]);
  const { seed } = card;
  useEffect(() => seed(all), [seed, all]);
  useEffect(() => setMoreLeft(hasMore), [hasMore]);

  return (
    <>
      <ul
        aria-label="Leads"
        className={cx(
          "enter-stagger grid gap-3",
          cols === 1
            ? "grid-cols-1 md:grid-cols-[repeat(auto-fill,minmax(340px,1fr))]"
            : "grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(232px,1fr))]",
        )}
      >
        {all.map((l, i) => (
          <li
            key={l.id}
            className="min-w-0"
            style={i < 10 ? ({ "--i": i } as CSSProperties) : undefined}
          >
            <LeadBox
              lead={l}
              layout={cols === 1 ? "grid1" : "grid2"}
              selected={card.openId === l.id}
              onOpen={card.open}
            />
          </li>
        ))}
      </ul>
      {moreLeft && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() =>
              start(async () => {
                const r = await loadMoreLeads({
                  ...filter,
                  offset: items.length + more.length,
                });
                setMore((p) => [...p, ...r.items]);
                setMoreLeft(r.hasMore);
              })
            }
            className="btn btn-secondary btn-md pressable"
          >
            {pending ? <Spinner size={16} /> : null}
            {pending ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </>
  );
}
