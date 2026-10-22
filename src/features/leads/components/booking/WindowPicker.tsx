"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import type {
  DayAvailability,
  TechSuggestion,
  WindowSlot,
} from "@/features/jobs/availability/types";
import {
  windowLabel,
  windowLabelLong,
  windowPart,
} from "@/features/jobs/availability/windows";
import { Avatar } from "@/ui/components/Avatar";
import { Pill } from "@/ui/components/StatusPill";
import { cx } from "@/ui/cx";

// The chosen day's 2-hour arrival windows as large buttons, then the tech for the
// chosen window (best one preselected) with a "Change" chooser in the Assign
// hub's look. Shared by the phone sheet and the desktop side panel.

const firstName = (n: string) => n.split(/\s+/)[0] ?? n;
const milesText = (t: TechSuggestion) =>
  t.extraMiles == null
    ? null
    : `adds ${t.extraMiles < 1 ? "<1" : Math.round(t.extraMiles)} mi`;

export function techsFor(w: WindowSlot | null | undefined): TechSuggestion[] {
  if (!w) return [];
  return [...(w.suggested ? [w.suggested] : []), ...w.alternatives];
}

export function WindowPicker({
  day,
  loading,
  selected,
  onSelect,
  techId,
  onTech,
}: {
  day: DayAvailability | null;
  loading: boolean;
  /** Selected window start ('HH:MM'). */
  selected: string | null;
  onSelect: (w: WindowSlot) => void;
  techId: string | null;
  onTech: (id: string) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  if (loading || !day)
    return (
      <div aria-busy className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="skeleton block h-[84px] rounded-tile" />
        ))}
      </div>
    );
  const win = day.windows.find((w) => w.start === selected) ?? null;
  const techs = techsFor(win);
  const tech = techs.find((t) => t.techId === techId) ?? null;
  const open = day.windows.filter((w) => w.status === "open").length;

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="win-h" className="flex flex-col gap-3">
        <h3 id="win-h" className="flex items-baseline justify-between gap-2">
          <span className="text-headline">Arrival window</span>
          <span className="text-footnote text-label-2">
            {open === 0
              ? "Nothing open"
              : `${open} of ${day.windows.length} open`}
          </span>
        </h3>
        {day.windows.length === 0 ? (
          <p className="text-subhead text-label-2">Closed this day.</p>
        ) : (
          <div
            role="radiogroup"
            aria-labelledby="win-h"
            className="grid grid-cols-2 gap-3"
          >
            {day.windows.map((w) => {
              const full = w.status === "full";
              const on = w.start === selected;
              const s = w.suggested;
              return (
                // biome-ignore lint/a11y/useSemanticElements: large card radio
                <button
                  key={w.start}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-disabled={full || undefined}
                  aria-label={`${windowLabelLong(w.start, w.end)}${full ? ", full" : s ? `, ${s.name}, ${milesText(s) ?? ""}` : ""}`}
                  onClick={() => {
                    if (full) return;
                    setChoosing(false);
                    onSelect(w);
                  }}
                  className={cx(
                    "flex min-h-[84px] flex-col items-start gap-1 rounded-tile px-3.5 py-3 text-left transition-[box-shadow,background-color] duration-[var(--dur-quick)]",
                    full
                      ? "cursor-default bg-fill-2 text-label-3"
                      : "pressable bg-card shadow-[inset_0_0_0_1px_var(--sep)] hover:shadow-[inset_0_0_0_1px_var(--label-3)]",
                    on &&
                      "bg-[color-mix(in_srgb,var(--label)_4%,var(--card))] shadow-[inset_0_0_0_2px_var(--label)] hover:shadow-[inset_0_0_0_2px_var(--label)]",
                  )}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span
                      className={cx(
                        "num text-title3",
                        full && "line-through decoration-[1.5px]",
                      )}
                    >
                      {windowLabel(w.start, w.end)}
                    </span>
                    {on && (
                      <span
                        aria-hidden
                        className="flex size-5 items-center justify-center rounded-full bg-label text-bg"
                      >
                        <Check size={13} strokeWidth={3} />
                      </span>
                    )}
                  </span>
                  <span className="text-footnote text-label-2">
                    {full ? "Full" : windowPart(w.start)}
                  </span>
                  {!full && s && (
                    <span className="mt-auto flex min-w-0 items-center gap-1.5 pt-1 text-footnote">
                      <Avatar
                        name={s.name}
                        seed={s.techId}
                        src={s.avatarUrl}
                        size={20}
                      />
                      <span className="truncate text-label">
                        {firstName(s.name)}
                        {milesText(s) ? (
                          <span className="text-label-2">
                            {" "}
                            · {milesText(s)}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {win && techs.length > 0 && (
        <section aria-labelledby="tech-h" className="flex flex-col gap-3">
          <h3 id="tech-h" className="flex items-center justify-between gap-2">
            <span className="text-headline">Technician</span>
            {techs.length > 1 && (
              <button
                type="button"
                aria-expanded={choosing}
                onClick={() => setChoosing((c) => !c)}
                className="hit-44 text-subhead font-semibold text-accent-text"
              >
                {choosing ? "Done" : "Change tech"}
              </button>
            )}
          </h3>
          {!choosing && tech ? (
            <div className="list-card flex items-center gap-3 px-4 py-3">
              <Avatar
                name={tech.name}
                seed={tech.techId}
                src={tech.avatarUrl}
                size={44}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-headline">{tech.name}</span>
                  {tech.techId === win.suggested?.techId && (
                    <Pill tone="accent" size="sm" dot={false}>
                      Recommended
                    </Pill>
                  )}
                </span>
                <span className="line-clamp-2 text-footnote text-label-2">
                  {tech.reasons.join(" · ")}
                </span>
              </span>
            </div>
          ) : (
            <div
              role="radiogroup"
              aria-labelledby="tech-h"
              className="list-card"
            >
              {techs.map((t, i) => {
                const on = t.techId === techId;
                return (
                  <div key={t.techId}>
                    {/* biome-ignore lint/a11y/useSemanticElements: list-row radio */}
                    <button
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => {
                        onTech(t.techId);
                        setChoosing(false);
                      }}
                      className="row-press list-row flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left"
                    >
                      <span
                        aria-hidden
                        className={cx(
                          "num flex size-7 shrink-0 items-center justify-center rounded-full text-footnote font-bold",
                          i === 0
                            ? "bg-accent-fill text-on-accent"
                            : "bg-fill text-label",
                        )}
                      >
                        {i + 1}
                      </span>
                      <Avatar
                        name={t.name}
                        seed={t.techId}
                        src={t.avatarUrl}
                        size={36}
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="text-headline">{t.name}</span>
                          {i === 0 && (
                            <Pill tone="accent" size="sm" dot={false}>
                              Recommended
                            </Pill>
                          )}
                        </span>
                        <span className="line-clamp-2 text-footnote text-label-2">
                          {t.reasons.join(" · ")}
                        </span>
                      </span>
                      <span
                        aria-hidden
                        className={cx(
                          "flex size-6 shrink-0 items-center justify-center rounded-full",
                          on
                            ? "bg-label text-bg"
                            : "shadow-[inset_0_0_0_1.5px_var(--label-3)]",
                        )}
                      >
                        {on && <Check size={14} strokeWidth={3} />}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
