"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import {
  type Segment,
  SegmentedControl,
} from "@/ui/components/SegmentedControl";

/**
 * Segmented control bound to a URL search param (deep-linkable tabs, Appendix A).
 * Changing it replaces the URL (no history entry) and drops the pagination cursor.
 */
export function UrlTabs<V extends string>({
  param = "tab",
  value,
  segments,
  label,
  className,
}: {
  param?: string;
  value: V;
  segments: readonly Segment<V>[];
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <div aria-busy={pending} className={className}>
      <SegmentedControl<V>
        label={label}
        value={value}
        segments={segments}
        onChange={(v) => {
          const next = new URLSearchParams(sp.toString());
          next.set(param, v);
          next.delete("cursor");
          start(() =>
            router.replace(`${path}?${next.toString()}`, { scroll: false }),
          );
        }}
      />
    </div>
  );
}
