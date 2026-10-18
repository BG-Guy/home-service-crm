"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { cx } from "@/ui/cx";

/** More segments than this don't fit a 390 px segmented control (QA T4-15). */
const MAX_SEGMENTS = 5;

/**
 * SegmentedControl bound to a URL search param (server-rendered filters/tabs).
 * Uses `router.replace` so switching segments doesn't stack history entries.
 * With more than five segments it renders a scrolling chip row instead, so labels
 * never truncate on a phone.
 */
export function SegmentLinks<V extends string>({
  param,
  value,
  segments,
  label,
  className,
  clear,
}: {
  param: string;
  value: V;
  segments: readonly { value: V; label: string }[];
  label: string;
  className?: string;
  /** Other params to drop when switching (e.g. a cursor). */
  clear?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const hrefFor = (v: V) => {
    const next = new URLSearchParams(params.toString());
    next.set(param, v);
    for (const c of clear ?? []) next.delete(c);
    return `${pathname}?${next.toString()}`;
  };

  if (segments.length > MAX_SEGMENTS)
    return (
      <ChipRow label={label} className={className}>
        {segments.map((s) => (
          <Chip
            key={s.value}
            href={hrefFor(s.value)}
            replace
            selected={s.value === value}
          >
            {s.label}
          </Chip>
        ))}
      </ChipRow>
    );

  return (
    <div className={cx(pending && "opacity-80 transition-opacity", className)}>
      <SegmentedControl
        label={label}
        value={value}
        segments={segments}
        onChange={(v) =>
          start(() => router.replace(hrefFor(v), { scroll: false }))
        }
      />
    </div>
  );
}
