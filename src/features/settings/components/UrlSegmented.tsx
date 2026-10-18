"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import {
  type Segment,
  SegmentedControl,
} from "@/ui/components/SegmentedControl";
import { cx } from "@/ui/cx";

/**
 * SegmentedControl bound to one search param (filters, periods). Changing it
 * replaces the URL without a scroll jump; the server page re-renders with the
 * new param. `clear` lists params removed on change (e.g. custom from/to). The
 * selection moves at once (optimistic) while the page loads.
 */
export function UrlSegmented<V extends string>({
  param,
  value,
  segments,
  label,
  defaultValue,
  clear = [],
  onChange,
  className,
}: {
  param: string;
  value: V;
  segments: readonly Segment<V>[];
  label: string;
  /** The value that is represented by an absent param. */
  defaultValue?: V;
  clear?: string[];
  /** Called before navigating (e.g. to reset local UI state). */
  onChange?: (value: V) => void;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [shown, setShown] = useOptimistic(value);
  return (
    <div
      className={cx("transition-opacity", pending && "opacity-70", className)}
      aria-busy={pending || undefined}
    >
      <SegmentedControl
        label={label}
        value={shown}
        segments={segments}
        onChange={(v) => {
          onChange?.(v);
          const next = new URLSearchParams(params.toString());
          if (v === defaultValue) next.delete(param);
          else next.set(param, v);
          for (const c of clear) next.delete(c);
          const qs = next.toString();
          start(() => {
            setShown(v);
            router.replace(qs ? `${pathname}?${qs}` : pathname, {
              scroll: false,
            });
          });
        }}
      />
    </div>
  );
}
