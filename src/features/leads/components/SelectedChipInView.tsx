"use client";

import { useEffect, useRef } from "react";

/**
 * Keeps the selected status chip in view: the chip row scrolls sideways, so a
 * chip far to the right (Lost, Spam) would otherwise be off screen once picked.
 * Renders a hidden marker inside the row.
 */
export function SelectedChipInView({ selected }: { selected: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: rerun when the pick changes
  useEffect(() => {
    const row = ref.current?.parentElement;
    const chip = row?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!row || !chip) return;
    const left = chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2;
    row.scrollTo({ left: Math.max(0, left), behavior: "instant" });
  }, [selected]);
  return <span ref={ref} hidden />;
}
