"use client";

import { Briefcase, Maximize2, MessageCircle } from "lucide-react";
import dynamic from "next/dynamic";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { CallButton } from "@/features/customers/components/CallButton";
import type { DocCard, DocPeekResult } from "@/lib/doc-cards";
import { MoneyText } from "@/ui/components/MoneyText";
import { RoundAction } from "@/ui/components/RoundAction";
import { StatusPill } from "@/ui/components/StatusPill";
import { cx } from "@/ui/cx";

const DocPeekSheet = dynamic(() => import("./DocPeekSheet"), { ssr: false });

const PARAM = "doc";

/**
 * The card layout of the estimates and invoices lists (like the job cards): one
 * card per document with the status and amount on top, the customer, the number
 * and title, a status line, and four actions: Call (through the app), Text, Job
 * and Open. Open, or a tap on the card, peeks at it in a sheet (`?doc=<id>`, Back
 * closes it); the peek's button opens the full page.
 */
export function DocCards({
  cards,
  label,
  loadPeek,
}: {
  cards: DocCard[];
  /** The grid's accessible name ("Estimates"). */
  label: string;
  /** Server action: the peek's details (the full page's access rules). */
  loadPeek(id: string): Promise<DocPeekResult>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [used, setUsed] = useState(false);
  const pushed = useRef(false);
  useEffect(() => {
    if (openId) setUsed(true);
  }, [openId]);

  // ?doc=<id>: open on load and on Back / Forward.
  useEffect(() => {
    const read = () => {
      const id = new URL(window.location.href).searchParams.get(PARAM);
      if (!id) pushed.current = false;
      setOpenId(id);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  // One pushed entry while a peek is open (null state, so the app router keeps
  // the URL), so Back closes it; closing steps back over it.
  const open = useCallback((id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(PARAM, id);
    if (pushed.current) window.history.replaceState(null, "", url);
    else {
      window.history.pushState(null, "", url);
      pushed.current = true;
    }
    setOpenId(id);
  }, []);
  const close = useCallback(() => {
    setOpenId(null);
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    if (url.searchParams.has(PARAM)) {
      url.searchParams.delete(PARAM);
      window.history.replaceState(null, "", url);
    }
  }, []);

  const card = openId ? (cards.find((c) => c.id === openId) ?? null) : null;
  return (
    <>
      <ul
        aria-label={label}
        className="enter-stagger grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]"
      >
        {cards.map((c, i) => (
          <li
            key={c.id}
            className="min-w-0"
            style={i < 10 ? ({ "--i": i } as CSSProperties) : undefined}
          >
            <DocBox card={c} onOpen={open} />
          </li>
        ))}
      </ul>
      {(used || openId) && (
        <DocPeekSheet card={card} loadPeek={loadPeek} onClose={close} />
      )}
    </>
  );
}

function DocBox({
  card: c,
  onOpen,
}: {
  card: DocCard;
  onOpen(id: string): void;
}) {
  return (
    <article className="hover-lift relative flex h-full flex-col gap-3 rounded-card bg-card p-4 shadow-card transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <StatusPill kind={c.kind} status={c.status} size="sm" />
        <span className="flex flex-col items-end">
          <MoneyText cents={c.amountCents} className="text-headline" />
          {c.amountNote && (
            <span className="text-footnote text-label-2">{c.amountNote}</span>
          )}
        </span>
      </div>
      <div className="min-w-0">
        <h3 className="min-w-0">
          <button
            type="button"
            onClick={() => onOpen(c.id)}
            className="box-hit block max-w-full truncate text-left text-headline outline-none"
          >
            {c.title}
          </button>
        </h3>
        <p className="truncate text-subhead text-label-2">{c.subtitle}</p>
        <p
          className={cx(
            "truncate text-footnote",
            c.alert ? "text-danger" : "text-label-2",
          )}
        >
          {c.meta}
        </p>
      </div>
      <div className="relative z-[1] mt-auto flex justify-between gap-1 border-hairline border-t pt-3">
        <CallButton customerId={c.customerId} label="Call" variant="round" />
        <RoundAction
          icon={<MessageCircle />}
          label="Text"
          size={52}
          tone="tinted"
          href={c.canText ? `/messages/${c.customerId}` : null}
          disabled={!c.canText}
        />
        <RoundAction
          icon={<Briefcase />}
          label={c.jobNumber ?? "Job"}
          size={52}
          tone="tinted"
          href={c.jobHref}
          disabled={!c.jobHref}
          ariaLabel={c.jobNumber ? `Open job ${c.jobNumber}` : "No job"}
        />
        <RoundAction
          icon={<Maximize2 />}
          label="Open"
          size={52}
          tone="tinted"
          ariaLabel={`Open the card for ${c.subtitle}`}
          onClick={() => onOpen(c.id)}
        />
      </div>
    </article>
  );
}
