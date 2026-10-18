"use client";

import { Check, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import {
  dismissSetupChecklistAction,
  setSetupItemAction,
} from "@/features/settings/actions";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import type { SetupChecklist } from "../setup";

/** M01 setup checklist card (admins, until complete or dismissed). */
export function SetupChecklistCard({
  checklist,
  canEdit,
}: {
  checklist: SetupChecklist;
  canEdit: boolean;
}) {
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
        {canEdit && (
          <button
            type="button"
            aria-label="Hide setup checklist"
            className="pressable -mt-1 -mr-1 flex size-11 items-center justify-center rounded-full text-label-2"
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
        )}
      </div>
      <ul className="border-t border-[var(--sep)]">
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
    </section>
  );
}
