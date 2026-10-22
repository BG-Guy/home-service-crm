"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useTransition } from "react";
import { addDaysToKey } from "@/lib/time";
import { Select } from "@/ui/components/Field";
import { PeriodStepper } from "@/ui/components/PeriodStepper";
import {
  type Segment,
  SegmentedControl,
} from "@/ui/components/SegmentedControl";

function useParamSetter() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = (patch: Record<string, string | null>, push = false) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("cursor");
    // Inside a full-screen hub a new view or date drops ?fs= on purpose: the hub
    // stays open, and closing it then pops nothing (DESIGN.md M19 rules).
    next.delete("fs");
    const qs = next.toString();
    const href = qs ? `${pathname}?${qs}` : pathname;
    start(() =>
      push
        ? router.push(href, { scroll: false })
        : router.replace(href, { scroll: false }),
    );
  };
  return { set, pending, sp };
}

/**
 * Segmented control bound to a search param (router.replace, no history entry;
 * `push` adds one, e.g. the schedule's Calendar | Map switch).
 */
export function ParamSegmented<V extends string>({
  param,
  value,
  segments,
  label,
  extra,
  push,
  className,
}: {
  param: string;
  value: V;
  segments: readonly Segment<V>[];
  label: string;
  /** Params to clear/set alongside. */
  extra?: Record<string, string | null>;
  /** Add a history entry, so back returns to the previous value. */
  push?: boolean;
  className?: string;
}) {
  const { set } = useParamSetter();
  return (
    <SegmentedControl
      label={label}
      value={value}
      segments={segments}
      className={className}
      onChange={(v) => set({ ...extra, [param]: v }, push)}
    />
  );
}

/**
 * PeriodStepper bound to a date search param (`YYYY-MM-DD`, router.replace):
 * the arrows move it by `step` days, e.g. a week on the schedule board.
 */
export function ParamPeriodStepper({
  param = "date",
  value,
  step,
  children,
  prevLabel,
  nextLabel,
  className,
}: {
  param?: string;
  /** The current date key. */
  value: string;
  /** Days per tap. */
  step: number;
  /** The period label. */
  children: ReactNode;
  prevLabel?: string;
  nextLabel?: string;
  className?: string;
}) {
  const { set } = useParamSetter();
  return (
    <PeriodStepper
      prevLabel={prevLabel}
      nextLabel={nextLabel}
      className={className}
      onPrev={() => set({ [param]: addDaysToKey(value, -step) })}
      onNext={() => set({ [param]: addDaysToKey(value, step) })}
    >
      {children}
    </PeriodStepper>
  );
}

/** Native select bound to a search param. */
export function ParamSelect({
  param,
  value,
  options,
  label,
  placeholder,
  className,
}: {
  param: string;
  value: string;
  options: { value: string; label: string }[];
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const { set } = useParamSetter();
  return (
    <Select
      label={label}
      hideLabel
      value={value}
      placeholder={placeholder}
      options={options}
      className={className}
      onChange={(e) => set({ [param]: e.target.value || null })}
    />
  );
}
