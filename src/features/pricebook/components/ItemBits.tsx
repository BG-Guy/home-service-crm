"use client";

import {
  Boxes,
  Hammer,
  Minus,
  Package,
  Plus,
  Receipt,
  Tag,
  Wrench,
} from "lucide-react";
import type { CSSProperties } from "react";
import { cx } from "@/ui/cx";

// Small pieces shared by the line editor's item cards and the price-book picker
// (Quote to Paid E2/E3): a colored tile per line type and an inline − 2 + pill.

type Kind = "service" | "labor" | "part" | "material" | "fee" | "discount";

const TILE: Record<Kind, { from: string; to: string; Icon: typeof Package }> = {
  part: { from: "#c99a3c", to: "#8f6219", Icon: Package },
  material: { from: "#3fb7a8", to: "#1d7f72", Icon: Boxes },
  labor: { from: "#ff9a4d", to: "#e0601f", Icon: Wrench },
  service: { from: "#6f8cff", to: "#4757d8", Icon: Hammer },
  fee: { from: "#9a9aa1", to: "#6b6b73", Icon: Receipt },
  discount: { from: "#3fc26a", to: "#23863c", Icon: Tag },
};

/** A rounded, colored tile with the line type's icon (white on a gradient). */
export function TypeTile({
  type,
  size = 52,
  className,
}: {
  type: string;
  size?: number;
  className?: string;
}) {
  const t = TILE[type as Kind] ?? TILE.service;
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.27),
    background: `linear-gradient(145deg, ${t.from}, ${t.to})`,
  };
  return (
    <span
      aria-hidden
      style={style}
      className={cx(
        "flex shrink-0 items-center justify-center text-white",
        className,
      )}
    >
      <t.Icon size={Math.round(size * 0.4)} strokeWidth={2.2} />
    </span>
  );
}

const qtyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

/**
 * Inline quantity pill: − 2 +. Whole steps; a fractional quantity steps by 1 and
 * never below `min`. Each half keeps a 44 px hit area (`hit-44`).
 */
export function QtyStepper({
  value,
  onChange,
  label,
  min = 1,
  disabled,
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  /** Accessible name, e.g. "Quantity of Grade 1 deadbolt". */
  label: string;
  /** Lowest value the minus button reaches (0 lets it remove the line). */
  min?: number;
  disabled?: boolean;
  className?: string;
}) {
  const btn =
    "hit-44 flex size-8 items-center justify-center rounded-full text-label outline-offset-[-2px] active:bg-fill disabled:text-label-3";
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would add unwanted chrome
    <div
      role="group"
      aria-label={label}
      className={cx(
        "inline-flex h-9 shrink-0 items-center gap-0.5 rounded-pill bg-fill-2 px-0.5",
        className,
      )}
    >
      <button
        type="button"
        aria-label={`One fewer (${label})`}
        className={btn}
        disabled={disabled || value - 1 < min}
        onClick={(e) => {
          e.stopPropagation();
          onChange(Math.max(min, Math.round((value - 1) * 1000) / 1000));
        }}
      >
        <Minus aria-hidden size={16} strokeWidth={2.6} />
      </button>
      <output
        aria-live="polite"
        className="num min-w-[2ch] text-center text-body font-semibold"
      >
        {qtyFmt.format(value)}
      </output>
      <button
        type="button"
        aria-label={`One more (${label})`}
        className={btn}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onChange(Math.round((value + 1) * 1000) / 1000);
        }}
      >
        <Plus aria-hidden size={16} strokeWidth={2.6} />
      </button>
    </div>
  );
}
