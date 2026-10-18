import {
  CircleAlert,
  CircleCheck,
  Info,
  Scale,
  TriangleAlert,
  WifiOff,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { type Tone, toneStyle } from "../tone";

export type BannerTone =
  | "info"
  | "success"
  | "warning"
  | "error"
  | "legal"
  | "offline";

const MAP: Record<BannerTone, { tone: Tone; Icon: typeof Info }> = {
  info: { tone: "blue", Icon: Info },
  success: { tone: "green", Icon: CircleCheck },
  warning: { tone: "orange", Icon: TriangleAlert },
  error: { tone: "red", Icon: CircleAlert },
  // ⚖️ compliance warnings (wage deductions, surcharging, consent…)
  legal: { tone: "indigo", Icon: Scale },
  offline: { tone: "gray", Icon: WifiOff },
};

/**
 * Inline banner for info / warnings / errors / ⚖️ compliance notes (SPEC §12.6).
 * Tinted card with icon, optional title, body, action and dismiss.
 * Server-renderable; `onDismiss` only works from a client parent.
 */
export function Banner({
  tone = "info",
  title,
  children,
  icon,
  action,
  onDismiss,
  className,
}: {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  /** Trailing action (e.g. `<Button size="sm" variant="tinted">Retry</Button>`). */
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const { tone: t, Icon } = MAP[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "tint-bg flex items-start gap-3 rounded-card px-3.5 py-3",
        className,
      )}
      style={toneStyle(t)}
    >
      <span aria-hidden className="tone-fg mt-px flex shrink-0">
        {icon ?? <Icon size={20} strokeWidth={2.25} />}
      </span>
      <div className="min-w-0 flex-1 text-subhead">
        {title && <div className="font-semibold">{title}</div>}
        {children && (
          <div className={cx(title ? "text-label-2" : "text-label")}>
            {children}
          </div>
        )}
        {action && <div className="mt-2">{action}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="relative -m-1 flex size-7 shrink-0 items-center justify-center rounded-full text-label-2 before:absolute before:-inset-2 before:content-[''] hover:bg-fill-2"
        >
          <X aria-hidden size={16} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
