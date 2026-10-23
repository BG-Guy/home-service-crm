"use client";

import { LayoutGrid, Map as MapIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "@/ui/cx";

/**
 * The inbox's Grid / Map switch on phones (item 10): a dark floating pill, the
 * same look as the grid's (InboxView), carried on the map's drawer.
 *
 * ```tsx
 * <GridMapSwitch value="grid" onChange={(v) => setShow(v)} />
 * ```
 */
export function GridMapSwitch({
  value,
  onChange,
  className,
}: {
  value: "grid" | "map";
  onChange: (value: "grid" | "map") => void;
  className?: string;
}) {
  const item = (v: "grid" | "map", label: string, icon: ReactNode) => (
    <button
      type="button"
      aria-pressed={value === v}
      onClick={() => value !== v && onChange(v)}
      className={cx(
        "pressable flex h-10 items-center gap-2 rounded-pill px-4 text-subhead font-semibold outline-offset-2 transition-colors duration-[var(--dur-quick)]",
        value === v ? "bg-white text-[#111113]" : "text-white",
      )}
    >
      {icon}
      {label}
    </button>
  );
  return (
    // biome-ignore lint/a11y/useSemanticElements: a two-button toggle group, not a form fieldset
    <div
      role="group"
      aria-label="Show leads as"
      className={cx(
        "flex w-fit gap-1 rounded-pill bg-[#111113] p-1 shadow-[var(--shadow-float)] dark:bg-[#2c2c2e]",
        className,
      )}
    >
      {item("grid", "Grid", <LayoutGrid size={17} aria-hidden />)}
      {item("map", "Map", <MapIcon size={17} aria-hidden />)}
    </div>
  );
}
