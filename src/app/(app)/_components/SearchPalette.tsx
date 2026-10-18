"use client";

import {
  Briefcase,
  FileText,
  Receipt,
  Search,
  UserPlus,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { searchEverything } from "@/features/customers/actions";
import type { SearchHit } from "@/features/customers/contracts";
import { Sheet } from "@/ui/components/Sheet";
import { Spinner } from "@/ui/components/Spinner";
import { cx } from "@/ui/cx";
import { NAV_FORWARD } from "@/ui/motion/PageTransition";

const ICON: Record<SearchHit["type"], ReactNode> = {
  customer: <Users aria-hidden size={18} />,
  job: <Briefcase aria-hidden size={18} />,
  invoice: <Receipt aria-hidden size={18} />,
  estimate: <FileText aria-hidden size={18} />,
  lead: <UserPlus aria-hidden size={18} />,
};

const TYPE_LABEL: Record<SearchHit["type"], string> = {
  customer: "Customer",
  job: "Job",
  invoice: "Invoice",
  estimate: "Estimate",
  lead: "Lead",
};

/**
 * ⌘K global search (QA T2-11): customers, jobs, invoices, estimates and leads by
 * name, phone, address or number, row-scoped on the server (searchEverything).
 * ↑/↓ move, Enter opens, Esc closes.
 */
export function SearchPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  const query = q.trim();

  useEffect(() => {
    const mine = ++seq.current;
    if (query.length < 2) {
      setHits([]);
      setLoading(false);
      setFailed(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      searchEverything(query).then(
        (r) => {
          if (seq.current !== mine) return;
          setHits(r);
          setActive(0);
          setFailed(false);
          setLoading(false);
        },
        () => {
          if (seq.current !== mine) return;
          setFailed(true);
          setLoading(false);
        },
      );
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  const go = (hit: SearchHit | undefined) => {
    if (!hit) return;
    onOpenChange(false);
    router.push(hit.href, { transitionTypes: NAV_FORWARD });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      label="Search"
      detents={["large"]}
      bodyClassName="px-[var(--gutter)] pb-6"
      onClosed={() => {
        setQ("");
        setHits([]);
      }}
    >
      <div className="sticky top-0 z-[1] flex items-center gap-3 bg-[var(--sheet-bg)] pb-3 pt-1">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-control bg-fill-2 px-3">
          <Search aria-hidden size={17} className="shrink-0 text-label-2" />
          <input
            data-autofocus
            type="search"
            enterKeyHint="go"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls={listId}
            aria-activedescendant={
              hits[active] ? `${listId}-${active}` : undefined
            }
            aria-label="Search customers, jobs, invoices, estimates and leads"
            placeholder="Name, phone, street, J-1001…"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(hits.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(hits[active]);
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-label-3"
          />
          {loading && <Spinner size={16} />}
        </label>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="min-h-11 shrink-0 text-body text-accent-text"
        >
          Cancel
        </button>
      </div>

      {hits.length > 0 ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Results"
          tabIndex={-1}
          className="list-card"
        >
          {hits.map((h, i) => (
            <div
              key={`${h.type}:${h.id}`}
              id={`${listId}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              onClick={() => go(h)}
              onKeyDown={(e) => {
                if (e.key === "Enter") go(h);
              }}
              onPointerMove={() => setActive(i)}
              className={cx(
                "list-row flex min-h-11 w-full cursor-pointer items-center gap-3 px-4 py-2 text-left",
                i === active && "bg-fill-2",
              )}
              data-icon=""
            >
              <span className="flex size-[29px] shrink-0 items-center justify-center rounded-[7px] bg-fill-2 text-label-2">
                {ICON[h.type]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body">{h.title}</span>
                <span className="block truncate text-footnote text-label-2">
                  {TYPE_LABEL[h.type]}
                  {h.subtitle ? ` · ${h.subtitle}` : ""}
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="px-1 pt-6 text-center text-subhead text-label-2">
          {query.length < 2
            ? "Search by name, phone, street or number."
            : failed
              ? "Search isn't available right now."
              : loading
                ? "Searching…"
                : `No matches for “${query}”.`}
        </p>
      )}
    </Sheet>
  );
}
