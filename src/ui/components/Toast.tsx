"use client";

import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { cx } from "../cx";
import { haptic } from "../motion/haptics";
import { EASE, prefersReducedMotion } from "../motion/springs";
import { type Tone, toneStyle } from "../tone";

export type ToastTone = "default" | "success" | "error" | "warning";

export interface ToastInput {
  title: string;
  message?: string;
  tone?: ToastTone;
  /** Custom leading icon (defaults by tone). */
  icon?: ReactNode;
  /** Shows an "Undo" button; called when tapped. */
  undo?: () => void;
  /** A custom action button. */
  action?: { label: string; onPress: () => void };
  /** ms before auto-dismiss (default 3000; 5000 with undo/action; 0 = sticky). */
  duration?: number;
  /** Reuse an id to replace an existing toast (e.g. "sync-status"). */
  id?: string;
}

interface ToastItem extends ToastInput {
  id: string;
  leaving: boolean;
}

/* ---------- module store (no context needed; call toast() from anywhere) ---------- */

const MAX_VISIBLE = 3;
let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const EMPTY: ToastItem[] = [];

function remove(id: string) {
  items = items.filter((t) => t.id !== id);
  emit();
}

/** Show a toast; returns its id. Max 3 visible — the oldest is dismissed first. */
export function toast(input: ToastInput | string): string {
  const t = typeof input === "string" ? { title: input } : input;
  const id = t.id ?? `t${++seq}`;
  const existing = items.findIndex((x) => x.id === id);
  const item: ToastItem = { ...t, id, leaving: false };
  if (existing >= 0) items = items.map((x) => (x.id === id ? item : x));
  else items = [item, ...items];
  const live = items.filter((x) => !x.leaving);
  if (live.length > MAX_VISIBLE) {
    const drop = new Set(live.slice(MAX_VISIBLE).map((x) => x.id));
    items = items.map((x) => (drop.has(x.id) ? { ...x, leaving: true } : x));
  }
  if (t.tone === "success" || t.tone === "error") haptic();
  emit();
  return id;
}

/** Start the exit animation for a toast. */
toast.dismiss = (id: string) => {
  items = items.map((x) => (x.id === id ? { ...x, leaving: true } : x));
  emit();
};
toast.success = (title: string, o?: Omit<ToastInput, "title" | "tone">) =>
  toast({ ...o, title, tone: "success" });
toast.error = (title: string, o?: Omit<ToastInput, "title" | "tone">) =>
  toast({ ...o, title, tone: "error" });
toast.warning = (title: string, o?: Omit<ToastInput, "title" | "tone">) =>
  toast({ ...o, title, tone: "warning" });

/** Hook form of `toast` (same function; for symmetry with other hooks). */
export function useToast() {
  return toast;
}

/* ---------- view ---------- */

const TONE: Record<ToastTone, { tone: Tone; Icon: typeof Info }> = {
  default: { tone: "accent", Icon: Info },
  success: { tone: "green", Icon: CircleCheck },
  error: { tone: "red", Icon: CircleAlert },
  warning: { tone: "orange", Icon: TriangleAlert },
};

function ToastView({
  t,
  index,
  expanded,
}: {
  t: ToastItem;
  index: number;
  expanded: boolean;
}) {
  const inner = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const drag = useRef<{ y: number; id: number } | null>(null);
  const duration = t.duration ?? (t.undo || t.action ? 5000 : 3000);

  useEffect(() => {
    if (t.leaving || paused || duration === 0) return;
    const h = setTimeout(() => toast.dismiss(t.id), duration);
    return () => clearTimeout(h);
  }, [t.leaving, paused, duration, t.id]);

  useEffect(() => {
    if (!t.leaving) return;
    const el = inner.current;
    if (!el || prefersReducedMotion()) {
      remove(t.id);
      return;
    }
    const a = el.animate(
      [
        { opacity: 1 },
        { opacity: 0, transform: "translateY(-60%) scale(0.92)" },
      ],
      { duration: 260, easing: "ease-in", fill: "forwards" },
    );
    a.finished.then(
      () => remove(t.id),
      () => remove(t.id),
    );
  }, [t.leaving, t.id]);

  const { tone, Icon } = TONE[t.tone ?? "default"];
  const y = expanded ? index * 72 : index * 10;
  const scale = expanded ? 1 : 1 - index * 0.05;
  const front = index === 0 || expanded;
  const multiline = index === 0 && !expanded;

  return (
    <div
      className="absolute inset-x-0 top-0"
      style={{
        transform: `translateY(${y}px) scale(${scale})`,
        transformOrigin: "top center",
        zIndex: MAX_VISIBLE + 1 - index,
        opacity: t.leaving ? undefined : index >= MAX_VISIBLE ? 0 : 1,
        transition: `transform var(--dur-snappy) var(--ease-spring-snappy), opacity 200ms`,
        pointerEvents: front && !t.leaving ? "auto" : "none",
      }}
      aria-hidden={!front || undefined}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: swipe-to-dismiss + hover pause; buttons inside are the controls */}
      <div
        ref={inner}
        className={`enter-toast material flex min-h-12 touch-none items-center gap-3 rounded-[22px] py-2.5 pl-3.5 pr-2 shadow-[var(--shadow-float),0_0_0_0.5px_var(--sep)] [&>*]:transition-opacity [&>*]:duration-200 ${front ? "" : "[&>*]:opacity-0"}`}
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        onPointerDown={(e) => {
          if ((e.target as Element).closest("button")) return;
          drag.current = { y: e.clientY, id: e.pointerId };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const dy = Math.min(0, e.clientY - d.y);
          e.currentTarget.style.transform = `translateY(${dy}px)`;
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d) return;
          const dy = e.clientY - d.y;
          if (dy < -24) toast.dismiss(t.id);
          else
            e.currentTarget.animate(
              [
                { transform: e.currentTarget.style.transform },
                { transform: "none" },
              ],
              { duration: 400, easing: EASE.snappy },
            );
          e.currentTarget.style.transform = "";
        }}
      >
        <span
          aria-hidden
          className="tone-fg flex shrink-0"
          style={toneStyle(tone)}
        >
          {t.icon ?? <Icon size={22} strokeWidth={2.25} />}
        </span>
        {/* The top toast shows up to 3 lines (a long error must be readable,
            QA T3-22); the expanded stack keeps one line per toast (72 px rows). */}
        <div className="min-w-0 flex-1">
          <div
            className={cx(
              "text-subhead font-semibold",
              multiline ? "line-clamp-3 break-words" : "truncate",
            )}
          >
            {t.title}
          </div>
          {t.message && (
            <div
              className={cx(
                "text-footnote text-label-2",
                multiline ? "line-clamp-3 break-words" : "truncate",
              )}
            >
              {t.message}
            </div>
          )}
        </div>
        {(t.undo || t.action) && (
          <button
            type="button"
            className="min-h-11 shrink-0 rounded-pill px-3 text-subhead font-semibold text-accent-text active:bg-fill-2"
            onClick={() => {
              (t.undo ?? t.action?.onPress)?.();
              toast.dismiss(t.id);
            }}
          >
            {t.undo ? "Undo" : t.action?.label}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Toast host (SPEC §12.6): top capsule `.material`, auto-dismiss 3 s (5 s with
 * Undo), queue max 3 stacked as a deck (expands on hover/focus), swipe up to
 * dismiss, announced via a polite live region. Mount once (see `AppProviders`),
 * then call `toast(...)` anywhere on the client.
 */
export function Toaster() {
  const list = useSyncExternalStore(
    subscribe,
    () => items,
    () => EMPTY,
  );
  const [expanded, setExpanded] = useState(false);
  const live = list.filter((t) => !t.leaving);
  const latest = live[0];

  return (
    <>
      <div aria-live="polite" aria-atomic className="sr-only">
        {latest
          ? `${latest.title}${latest.message ? `. ${latest.message}` : ""}`
          : ""}
      </div>
      <section
        aria-label="Notifications"
        className="toast-region"
        style={{ height: list.length ? 64 : 0 }}
        onPointerEnter={() => setExpanded(true)}
        onPointerLeave={() => setExpanded(false)}
        onFocusCapture={() => setExpanded(true)}
        onBlurCapture={() => setExpanded(false)}
      >
        {list.map((t) => (
          <ToastView
            key={t.id}
            t={t}
            index={list.indexOf(t)}
            expanded={expanded && live.length > 1}
          />
        ))}
      </section>
    </>
  );
}
