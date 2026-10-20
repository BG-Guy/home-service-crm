import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../cx";

/**
 * Chat bubble (DESIGN.md §7, iMessage-like, presentational). Outgoing = accent,
 * right; incoming = neutral fill, left. Pass `tail` on the last bubble of a
 * consecutive group. The thread container and Composer belong to the messaging
 * module.
 */
export function MessageBubble({
  direction,
  children,
  tail = true,
  meta,
  status,
  failed,
  channel,
  className,
}: {
  direction: "in" | "out";
  children: ReactNode;
  /** Show the tail (last bubble of a group). */
  tail?: boolean;
  /** Small text under the bubble (time, "Delivered"). */
  meta?: ReactNode;
  /** Status word for screen readers / meta (e.g. "Delivered"). */
  status?: string;
  /** Red error glyph next to the bubble. */
  failed?: boolean;
  /** "SMS", "Email"… shown in meta when given. */
  channel?: string;
  className?: string;
}) {
  const out = direction === "out";
  return (
    <div
      className={cx(
        "flex flex-col",
        out ? "items-end" : "items-start",
        tail ? "mb-2" : "mb-0.5",
        className,
      )}
    >
      <div
        className={cx(
          "flex max-w-[78%] items-end gap-1.5",
          out && "flex-row-reverse",
        )}
      >
        <div
          className={cx(
            "relative whitespace-pre-wrap break-words rounded-[20px] px-3.5 py-2 text-body",
            out ? "bg-accent-fill text-on-accent" : "bg-fill text-label",
            tail && (out ? "rounded-br-md" : "rounded-bl-md"),
          )}
        >
          {children}
        </div>
        {failed && (
          <CircleAlert
            aria-label="Not delivered"
            size={18}
            className="mb-1 shrink-0 text-danger"
          />
        )}
      </div>
      {(meta || channel || status) && tail && (
        <div className="mt-1 px-2 text-caption text-label-2">
          {[channel, meta, status].filter(Boolean).map((x, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static meta parts
            <span key={i}>
              {i > 0 && " · "}
              {x}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Centered day/time separator between message groups. */
export function MessageSeparator({ children }: { children: ReactNode }) {
  return (
    <div className="my-3 text-center text-caption font-medium text-label-2">
      {children}
    </div>
  );
}
