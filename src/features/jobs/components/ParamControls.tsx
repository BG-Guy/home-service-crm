"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/ui/components/Field";
import {
  type Segment,
  SegmentedControl,
} from "@/ui/components/SegmentedControl";

function useParamSetter() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("cursor");
    const qs = next.toString();
    start(() =>
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }),
    );
  };
  return { set, pending, sp };
}

/** Segmented control bound to a search param (router.replace, no history entry). */
export function ParamSegmented<V extends string>({
  param,
  value,
  segments,
  label,
  extra,
  className,
}: {
  param: string;
  value: V;
  segments: readonly Segment<V>[];
  label: string;
  /** Params to clear/set alongside. */
  extra?: Record<string, string | null>;
  className?: string;
}) {
  const { set } = useParamSetter();
  return (
    <SegmentedControl
      label={label}
      value={value}
      segments={segments}
      className={className}
      onChange={(v) => set({ ...extra, [param]: v })}
    />
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
