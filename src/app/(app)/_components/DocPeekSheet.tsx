"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DocCard, DocPeek, DocPeekResult } from "@/lib/doc-cards";
import { Button } from "@/ui/components/Button";
import { IconButton } from "@/ui/components/IconButton";
import { MoneyText } from "@/ui/components/MoneyText";
import { Sheet } from "@/ui/components/Sheet";
import { Skeleton } from "@/ui/components/Skeleton";
import { StatusPill } from "@/ui/components/StatusPill";
import { cx } from "@/ui/cx";

/**
 * A document's peek (estimates and invoices; lazy chunk): the money on top, the
 * key facts, the first lines and the notes, loaded on open (the card shows at
 * once). The button opens the full page.
 */
export default function DocPeekSheet({
  card,
  loadPeek,
  onClose,
}: {
  card: DocCard | null;
  loadPeek(id: string): Promise<DocPeekResult>;
  onClose(): void;
}) {
  const [peek, setPeek] = useState<DocPeek | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = card?.id ?? null;
  // A server action passed from the page is a new function after every refresh
  // (the action's own response refreshes the page): keep it out of the effect's
  // deps, or each response would start the next load.
  const load = useRef(loadPeek);
  load.current = loadPeek;
  useEffect(() => {
    setPeek(null);
    setError(null);
    if (!id) return;
    let live = true;
    load
      .current(id)
      .then((r) => {
        if (!live) return;
        if (r.ok) setPeek(r.data);
        else setError(r.error);
      })
      .catch(() => {
        if (live) setError("Couldn't load this.");
      });
    return () => {
      live = false;
    };
  }, [id]);

  const p = peek?.id === id ? peek : null;
  const noun = card?.kind === "invoice" ? "Invoice" : "Estimate";
  return (
    <Sheet
      open={!!card}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      label={card ? `${noun} ${card.subtitle}` : noun}
      detents={["large"]}
      trailing={
        <IconButton
          label="Close"
          variant="secondary"
          size={30}
          onClick={onClose}
        >
          <X size={17} strokeWidth={2.5} />
        </IconButton>
      }
      bodyClassName="pt-1"
      footer={
        card ? (
          <Button href={card.href} block size="lg">
            {p?.openLabel ?? `Open ${noun.toLowerCase()}`}
          </Button>
        ) : null
      }
    >
      {card && (
        <div className="flex flex-col gap-5 pb-2">
          <header className="flex flex-col gap-1.5">
            <h2 className="text-title2">{card.title}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill kind={card.kind} status={p?.status ?? card.status} />
              <span className="text-subhead text-label-2">
                {p?.title ?? card.subtitle}
              </span>
            </div>
          </header>

          <section
            aria-label="Amounts"
            className="flex flex-col rounded-tile bg-fill-2 px-3"
          >
            {(
              p?.amounts ?? [
                { label: "Amount", cents: card.amountCents, strong: true },
              ]
            ).map((a, i) => (
              <div
                key={a.label}
                className={cx(
                  "flex items-baseline justify-between gap-3 py-2.5",
                  i > 0 && "border-hairline border-t",
                )}
              >
                <span
                  className={cx(
                    "text-subhead",
                    a.strong ? "font-semibold" : "text-label-2",
                  )}
                >
                  {a.label}
                </span>
                <MoneyText
                  cents={a.cents}
                  className={cx(
                    a.strong ? "text-headline" : "text-subhead",
                    a.tone === "danger" && "text-danger",
                  )}
                />
              </div>
            ))}
          </section>

          {p && p.facts.length > 0 && (
            <dl className="grid gap-3 sm:grid-cols-2">
              {p.facts.map((f) => (
                <div
                  key={f.label}
                  className="rounded-tile bg-fill-2 px-3 py-2.5"
                >
                  <dt className="text-footnote text-label-2">{f.label}</dt>
                  <dd
                    className={cx(
                      "text-subhead",
                      f.tone === "danger" && "text-danger",
                    )}
                  >
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {p && p.lines.length > 0 && (
            <section className="flex flex-col gap-1">
              <h3 className="text-footnote font-semibold text-label-2">
                Line items
              </h3>
              <ul className="flex flex-col">
                {p.lines.map((l, i) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: a static read-only list
                    key={i}
                    className={cx(
                      "flex items-baseline justify-between gap-3 py-2",
                      i > 0 && "border-hairline border-t",
                    )}
                  >
                    <span className="min-w-0 text-subhead">
                      {l.qty !== 1 && (
                        <span className="num text-label-2">{l.qty} × </span>
                      )}
                      {l.name}
                    </span>
                    <MoneyText cents={l.cents} className="text-subhead" />
                  </li>
                ))}
              </ul>
              {p.moreLines > 0 && (
                <p className="text-footnote text-label-2">
                  {p.moreLines} more on the full page
                </p>
              )}
            </section>
          )}

          {p?.notes && (
            <p className="whitespace-pre-line rounded-tile bg-fill-2 px-3 py-2.5 text-subhead">
              {p.notes}
            </p>
          )}
          {!p && !error && <Skeleton className="h-24 rounded-tile" />}
          {error && <p className="text-subhead text-label-2">{error}</p>}
        </div>
      )}
    </Sheet>
  );
}
