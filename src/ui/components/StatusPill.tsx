import type { ReactNode } from "react";
import { cx } from "../cx";
import { type StatusKind, statusDef } from "../status";
import { type Tone, toneStyle } from "../tone";

/**
 * Tinted status capsule with a dot + label (never color alone).
 * Mapping lives in `src/ui/status.ts`.
 *
 * ```tsx
 * <StatusPill kind="job" status={job.status} />
 * <StatusPill kind="invoice" status="overdue" size="sm" />
 * ```
 */
export function StatusPill({
  kind,
  status,
  size = "md",
  label,
  className,
}: {
  kind: StatusKind;
  status: string;
  size?: "sm" | "md";
  /** Override the mapped label (e.g. "Due in 3 days"). */
  label?: string;
  className?: string;
}) {
  const def = statusDef(kind, status);
  return (
    <Pill tone={def.tone} size={size} className={className}>
      {label ?? def.label}
    </Pill>
  );
}

/** Generic tinted pill for ad-hoc states. */
export function Pill({
  tone = "gray",
  size = "md",
  dot = true,
  children,
  className,
}: {
  tone?: Tone;
  size?: "sm" | "md";
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "tint-bg tint-fg inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill font-semibold",
        size === "sm" ? "h-5 px-2 text-caption" : "h-6 px-2.5 text-footnote",
        className,
      )}
      style={toneStyle(tone)}
    >
      {dot && (
        <span
          aria-hidden
          className="size-1.5 rounded-full"
          style={{ background: "var(--tone)" }}
        />
      )}
      {children}
    </span>
  );
}
