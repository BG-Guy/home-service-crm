"use client";

import {
  ClipboardList,
  Hammer,
  type LucideIcon,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { Fragment, useId, useMemo } from "react";
import { Chip } from "@/ui/components/Chip";
import { cx } from "@/ui/cx";
import {
  type JobKind,
  KIND_COLOR,
  KIND_HINT,
  KIND_ICON,
  KIND_LABEL,
  splitByKind,
} from "../kinds";
import {
  type JobTypeRow,
  type JobTypeValue,
  kindDuration,
  kindPrice,
  OTHER_JOB,
  visitLength,
} from "./job-type-choice";

// The three job type cards (Free estimate / Service call / Project) with the
// trade's jobs under the picked one as "What's the job?" chips (leads-flow
// redesign, item 6). Used by the caller form, the booking What step and New job.
//
// `cards`: phones stack full-width cards with the chips right under the picked
// one (the approved sketch); from 640 px the cards sit 3 across with the chips
// below. `tiles`: 3 small tiles across at every size (the caller form, which has
// to fit the first screen).

// Icon names in kinds.ts (KIND_ICON) → the three lucide icons, imported directly
// so the client bundle doesn't pull the whole icon map.
const ICON_BY_NAME: Record<string, LucideIcon> = {
  clipboard: ClipboardList,
  tools: Wrench,
  hammer: Hammer,
};
const ICON_BY_KIND: Record<JobKind, LucideIcon> = {
  estimate: ClipboardList,
  service: Wrench,
  project: Hammer,
};

function KindTile({ kind, small }: { kind: JobKind; small?: boolean }) {
  const Icon = ICON_BY_NAME[KIND_ICON[kind]] ?? ICON_BY_KIND[kind];
  return (
    <span
      aria-hidden
      style={{
        backgroundColor: `color-mix(in srgb, ${KIND_COLOR[kind]} 16%, transparent)`,
        color: `color-mix(in srgb, ${KIND_COLOR[kind]} 78%, var(--label))`,
      }}
      className={cx(
        "flex shrink-0 items-center justify-center",
        small ? "size-9 rounded-[11px]" : "size-11 rounded-[14px]",
      )}
    >
      <Icon size={small ? 19 : 22} strokeWidth={2} />
    </span>
  );
}

export function JobTypePicker({
  types,
  value,
  onChange,
  variant = "cards",
  other = true,
  label = "Job type",
  error,
  className,
}: {
  /** Live job types (`listServiceTypeOptions()`), sorted. */
  types: readonly JobTypeRow[];
  value: JobTypeValue;
  onChange: (next: JobTypeValue) => void;
  variant?: "cards" | "tiles";
  /** Offer the "Other" chip (none of the trade's jobs). */
  other?: boolean;
  /** Accessible name of the cards. */
  label?: string;
  error?: string | null;
  className?: string;
}) {
  const groups = useMemo(
    () => splitByKind(types).filter((g) => g.primary || g.jobs.length > 0),
    [types],
  );
  const picked = groups.find((g) => g.kind === value.kind) ?? null;
  const chipsA = useId();
  const chipsB = useId();

  const pickKind = (kind: JobKind) =>
    onChange(
      kind === value.kind ? value : { kind, job: null }, // keep the chip on a re-tap
    );
  const pickJob = (job: string) =>
    picked &&
    onChange({ kind: picked.kind, job: value.job === job ? null : job });

  const job = picked?.jobs.find((j) => j.id === value.job) ?? null;
  const chips = (id: string, cls: string) =>
    picked && (picked.jobs.length > 0 || other) ? (
      <div className={cx("flex-col gap-2", cls)}>
        <span id={id} className="px-1 text-footnote font-semibold text-label-2">
          What's the job?
        </span>
        {/* biome-ignore lint/a11y/useSemanticElements: chip group */}
        <div role="group" aria-labelledby={id} className="flex flex-wrap gap-2">
          {picked.jobs.map((j) => (
            <Chip
              key={j.id}
              selected={value.job === j.id}
              onClick={() => pickJob(j.id)}
            >
              {j.name}
            </Chip>
          ))}
          {other && (
            <Chip
              selected={value.job === OTHER_JOB}
              onClick={() => pickJob(OTHER_JOB)}
            >
              Other
            </Chip>
          )}
        </div>
        {job?.requiresOwnershipCheck && (
          <p className="flex items-center gap-1.5 px-1 text-footnote font-semibold text-warning">
            <ShieldCheck aria-hidden size={15} className="shrink-0" />
            {job.name} keeps the ID and ownership check
          </p>
        )}
      </div>
    ) : null;

  const tiles = variant === "tiles";
  return (
    <div className={cx("flex flex-col gap-3", className)}>
      <div
        role="radiogroup"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        className={cx(
          "grid gap-2.5",
          tiles ? "grid-cols-3" : "sm:grid-cols-3 sm:gap-3",
        )}
      >
        {groups.map((g) => {
          const on = g.kind === value.kind;
          const price = kindPrice(g.kind, types);
          const minutes = kindDuration(types, g.kind, g.primary?.id);
          const hint =
            g.kind === "project"
              ? KIND_HINT[g.kind]
              : `${KIND_HINT[g.kind]} · ${visitLength(minutes)}`;
          const ring = on
            ? "ring-2 ring-inset ring-accent"
            : "shadow-card hover-lift";
          return (
            <Fragment key={g.kind}>
              {tiles ? (
                // biome-ignore lint/a11y/useSemanticElements: large card radio
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`${KIND_LABEL[g.kind]}: ${hint}${price ? `, ${price}` : ""}`}
                  onClick={() => pickKind(g.kind)}
                  className={cx(
                    "pressable flex min-h-[84px] min-w-0 flex-col items-center justify-center gap-1 rounded-tile bg-card px-1.5 py-2.5 text-center transition-shadow duration-[var(--dur-quick)]",
                    ring,
                  )}
                >
                  <KindTile kind={g.kind} small />
                  <span className="text-subhead font-semibold leading-tight text-label">
                    {KIND_LABEL[g.kind]}
                  </span>
                  <span className="text-caption text-label-2">
                    {price ?? visitLength(minutes)}
                  </span>
                </button>
              ) : (
                <>
                  {/* biome-ignore lint/a11y/useSemanticElements: large card radio */}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => pickKind(g.kind)}
                    className={cx(
                      "pressable grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 rounded-card bg-card p-4 text-left transition-shadow duration-[var(--dur-quick)]",
                      "sm:grid-cols-[minmax(0,1fr)_auto] sm:content-start sm:gap-y-2.5",
                      ring,
                    )}
                  >
                    <KindTile kind={g.kind} />
                    <span className="flex min-w-0 flex-col sm:col-span-2 sm:row-start-2">
                      <span className="text-headline text-label">
                        {KIND_LABEL[g.kind]}
                      </span>
                      <span className="text-footnote text-label-2">{hint}</span>
                    </span>
                    <span className="num text-headline text-label sm:col-start-2 sm:row-start-1 sm:self-start">
                      {price}
                    </span>
                  </button>
                  {on && chips(chipsA, "flex px-1 pb-1 sm:hidden")}
                </>
              )}
            </Fragment>
          );
        })}
      </div>
      {chips(chipsB, tiles ? "flex" : "hidden sm:flex")}
      {error && (
        <p className="px-1 text-footnote text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
