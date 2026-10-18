"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { cx } from "@/ui/cx";

/** SegmentedControl bound to a URL search param (server-rendered tabs/filters). */
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
  clear?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <div className={cx(pending && "opacity-80 transition-opacity", className)}>
      <SegmentedControl
        label={label}
        value={value}
        segments={segments}
        onChange={(v) => {
          const next = new URLSearchParams(params.toString());
          next.set(param, v);
          for (const c of clear ?? []) next.delete(c);
          start(() =>
            router.replace(`${pathname}?${next.toString()}`, { scroll: false }),
          );
        }}
      />
    </div>
  );
}
