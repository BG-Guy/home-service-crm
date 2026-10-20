import type { ReactNode } from "react";
import { cx } from "../cx";
import { type StatusKind, statusDef } from "../status";
import { type Tone, toneStyle } from "../tone";

/**
 * Soft tinted status capsule with a dot + label (never color alone). Live
 * states (job on the way / in progress, `live` in `src/ui/status.ts`) pulse the
 * dot (M12); keep that to two per screen with `live={false}` on the rest.
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
  live,
  className,
}: {
  kind: StatusKind;
  status: string;
  size?: "sm" | "md";
  /** Override the mapped label (e.g. "Due in 3 days"). */
  label?: string;
  /** Force the live pulse on or off (default: from the status map). */
  live?: boolean;
  className?: string;
}) {
  const def = statusDef(kind, status);
  return (
    <Pill
      tone={def.tone}
      size={size}
      live={live ?? def.live}
      className={className}
    >
      {label ?? def.label}
    </Pill>
  );
}

/** Generic soft pill for ad-hoc states. `live` pulses the dot (M12). */
export function Pill({
  tone = "gray",
  size = "md",
  dot = true,
  live,
  children,
  className,
}: {
  tone?: Tone;
  size?: "sm" | "md";
  dot?: boolean;
  live?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "tint-bg tint-fg inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill font-semibold tracking-normal",
        size === "sm" ? "h-5 px-2 text-caption" : "h-6 px-2.5 text-footnote",
        className,
      )}
      style={toneStyle(tone)}
    >
      {dot && (
        <span
          aria-hidden
          className={cx("size-1.5 rounded-full", live && "live-dot")}
          style={{ background: "var(--tone)" }}
        />
      )}
      {children}
    </span>
  );
}
