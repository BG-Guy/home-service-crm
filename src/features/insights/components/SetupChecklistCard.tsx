"use client";

import { Check, ChevronDown, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { useId, useOptimistic, useState, useTransition } from "react";
import {
  dismissSetupChecklistAction,
  setSetupItemAction,
} from "@/features/settings/actions";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import type { SetupChecklist } from "../setup";

/** Small progress ring with "9/13" inside (no chart module in this island). */
function Ring({ done, total }: { done: number; total: number }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const f = done / Math.max(1, total);
  return (
    <span className="relative flex size-12 shrink-0 items-center justify-center">
      <svg
        viewBox="0 0 48 48"
        className="absolute inset-0 -rotate-90"
        aria-hidden="true"
        role="presentation"
      >
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          strokeWidth="4"
          className="stroke-[var(--fill)]"
        />
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          stroke="var(--accent)"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - f)}
          className="transition-[stroke-dashoffset] duration-500 [transition-timing-function:var(--ease-spring)]"
        />
      </svg>
      <span className="num text-caption font-bold text-label">
        {done}/{total}
      </span>
    </span>
  );
}

/**
 * M01 setup checklist card (admins, until complete or dismissed). `compact` (Today)
 * is a small progress card, "Finish setting up · 9/13" with Continue to the next
 * open step; the full list opens in place (M15 disclosure).
 */
export function SetupChecklistCard({
  checklist,
  canEdit,
  compact,
}: {
  checklist: SetupChecklist;
  canEdit: boolean;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(!compact);
  const listId = useId();
  const [items, setItem] = useOptimistic(
    checklist.items,
    (state, u: { key: string; done: boolean }) =>
      state.map((i) => (i.key === u.key ? { ...i, done: u.done } : i)),
  );
  const [, start] = useTransition();
  const done = items.filter((i) => i.done).length;
  const pct = Math.round((done / Math.max(1, items.length)) * 100);

  function toggle(key: string, next: boolean) {
    start(async () => {
      setItem({ key, done: next });
      const r = await setSetupItemAction({ key, done: next });
      if (!r.ok) toast.error(r.error);
    });
  }

  const nextItem = items.find((i) => !i.done);
  const dismiss = canEdit ? (
    <button
      type="button"
      aria-label="Hide setup checklist"
      className="pressable -mt-1 -mr-1 flex size-11 shrink-0 items-center justify-center rounded-full text-label-2"
      onClick={() =>
        start(async () => {
          const r = await dismissSetupChecklistAction({
            dismissed: true,
          });
          if (r.ok)
            toast({
              title: "Checklist hidden",
              message: "Bring it back from Settings.",
            });
          else toast.error(r.error);
        })
      }
    >
      <X aria-hidden size={18} />
    </button>
  ) : null;

  const list = (
    <ul id={listId} className="border-t border-[var(--sep)]">
      {items.map((i) => (
        <li
          key={i.key}
          className="list-row flex min-h-11 items-center gap-3 pl-4"
        >
          <button
            type="button"
            disabled={!canEdit || i.auto}
            aria-pressed={i.done}
            aria-label={
              i.auto
                ? `${i.title}: ${i.done ? "done" : "to do"}`
                : `Mark “${i.title}” ${i.done ? "not done" : "done"}`
            }
            onClick={() => toggle(i.key, !i.done)}
            className="-ml-2 flex size-11 shrink-0 items-center justify-center disabled:cursor-default"
          >
            <span
              className={cx(
                "flex size-[22px] items-center justify-center rounded-full border-[1.5px] transition-[background-color,border-color,transform] duration-300 [transition-timing-function:var(--ease-spring-snappy)]",
                i.done
                  ? "scale-100 border-transparent bg-[var(--sys-green)] text-white"
                  : "border-label-3",
              )}
            >
              {i.done && <Check aria-hidden size={14} strokeWidth={3} />}
            </span>
          </button>
          <Link
            href={i.href}
            transitionTypes={["nav-forward"]}
            className="row-press flex min-h-11 min-w-0 flex-1 items-center gap-2 pr-4"
          >
            <span
              className={cx(
                "flex-1 truncate text-body",
                i.done && "text-label-2 line-through decoration-label-3",
              )}
            >
              {i.title}
            </span>
            <ChevronRight
              aria-hidden
              size={18}
              strokeWidth={2.5}
              className="shrink-0 text-label-3"
            />
          </Link>
        </li>
      ))}
    </ul>
  );

  if (compact)
    return (
      <section aria-labelledby="setup-h" className="card overflow-hidden">
        <div className="flex items-center gap-3 p-3 pl-4">
          <Ring done={done} total={items.length} />
          <div className="min-w-0 flex-1">
            <h2 id="setup-h" className="truncate text-headline">
              Finish setting up
            </h2>
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => setExpanded((e) => !e)}
              className="hit-44 flex max-w-full items-center gap-1 text-subhead text-label-2"
            >
              <span className="truncate">
                {nextItem ? `Next: ${nextItem.title}` : "All steps done"}
              </span>
              <ChevronDown
                aria-hidden
                size={15}
                className={cx(
                  "shrink-0 transition-transform duration-200",
                  expanded && "rotate-180",
                )}
              />
              <span className="sr-only">
                {expanded ? "Hide steps" : "Show all steps"}
              </span>
            </button>
          </div>
          {nextItem && (
            <Button
              href={nextItem.href}
              transition="push"
              variant="tinted"
              size="sm"
            >
              Continue
            </Button>
          )}
        </div>
        <div className="disclosure" data-open={expanded ? "" : undefined}>
          <div inert={!expanded}>
            {list}
            {canEdit && (
              <div className="flex justify-center border-t border-[var(--sep)] py-1">
                <Button
                  variant="plain"
                  size="sm"
                  onClick={() =>
                    start(async () => {
                      const r = await dismissSetupChecklistAction({
                        dismissed: true,
                      });
                      if (r.ok)
                        toast({
                          title: "Checklist hidden",
                          message: "Bring it back from Settings.",
                        });
                      else toast.error(r.error);
                    })
                  }
                >
                  Hide this checklist
                </Button>
              </div>
            )}
          </div>
        </div>
      </section>
    );

  return (
    <section
      aria-labelledby="setup-h"
      className="overflow-hidden rounded-card bg-card shadow-card"
    >
      <div className="flex items-start gap-3 p-4 pb-3">
        <div className="min-w-0 flex-1">
          <h2 id="setup-h" className="text-headline">
            Finish setting up
          </h2>
          <p className="text-subhead text-label-2">
            {done} of {items.length} done · most shops finish in under an hour
          </p>
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-fill-2"
            role="progressbar"
            aria-label="Setup progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500 [transition-timing-function:var(--ease-spring)]"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        {dismiss}
      </div>
      {list}
    </section>
  );
}
