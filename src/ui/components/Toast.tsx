"use client";

import { Icon, type IconNode } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { cx } from "../cx";
import { haptic } from "../motion/haptics";

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

// Glyphs drawn with lucide's generic <Icon> (no per-icon modules). Using it here
// also puts lucide's small "use client" runtime, which every page needs for its
// server-rendered icons, in the root chunk once instead of a copy per route
// chunk. The success check draws itself (M10).
const RING: IconNode[number] = [
  "circle",
  { cx: "12", cy: "12", r: "9.5", key: "r" },
];
const GLYPH: Record<ToastTone, IconNode> = {
  default: [RING, ["path", { d: "M12 16v-4M12 8h.01", key: "g" }]],
  success: [
    RING,
    [
      "path",
      {
        d: "m8 12.4 2.8 2.8 5.4-5.6",
        pathLength: 1,
        className: "toast-check",
        key: "g",
      },
    ],
  ],
  error: [RING, ["path", { d: "M12 7.5v5M12 16.2h.01", key: "g" }]],
  warning: [
    [
      "path",
      {
        d: "M10.3 4.1 2.6 17.5a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0Z",
        key: "t",
      },
    ],
    ["path", { d: "M12 9.5v3.5M12 16.7h.01", key: "g" }],
  ],
};

function ToastIcon({ tone }: { tone: ToastTone }) {
  return (
    <Icon iconNode={GLYPH[tone]} size={22} strokeWidth={2.25} aria-hidden />
  );
}

const LEAVE_MS = 200;

function ToastView({
  t,
  index,
  front,
  multiline,
}: {
  t: ToastItem;
  index: number;
  front: boolean;
  multiline: boolean;
}) {
  const [paused, setPaused] = useState(false);
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const duration = t.duration ?? (t.undo || t.action ? 5000 : 3000);
  const tone = t.tone ?? "default";

  useEffect(() => {
    if (t.leaving || paused || duration === 0) return;
    const h = setTimeout(() => toast.dismiss(t.id), duration);
    return () => clearTimeout(h);
  }, [t.leaving, paused, duration, t.id]);

  // The exit is CSS (`.toast[data-leaving]`: rise + fade, 200 ms).
  useEffect(() => {
    if (!t.leaving) return;
    const h = setTimeout(() => remove(t.id), LEAVE_MS);
    return () => clearTimeout(h);
  }, [t.leaving, t.id]);

  return (
    <div
      className="toast"
      data-tone={tone}
      data-front={front || undefined}
      data-leaving={t.leaving || undefined}
      data-hidden={index >= MAX_VISIBLE || undefined}
      style={{ "--i": index, zIndex: MAX_VISIBLE + 1 - index } as CSSProperties}
      aria-hidden={!front || undefined}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: swipe-to-dismiss + hover pause; buttons inside are the controls */}
      <div
        className="toast-card"
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        onPointerDown={(e) => {
          if ((e.target as Element).closest("button")) return;
          drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.style.transition = "none";
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          // Up (the phone island) or right (the desktop card) only.
          const dy = Math.min(0, e.clientY - d.y);
          const dx = Math.max(0, e.clientX - d.x);
          e.currentTarget.style.translate = `${dx}px ${dy}px`;
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d) return;
          const el = e.currentTarget;
          el.style.transition = "";
          el.style.translate = "";
          if (e.clientY - d.y < -24 || e.clientX - d.x > 64)
            toast.dismiss(t.id);
        }}
        onPointerCancel={(e) => {
          drag.current = null;
          e.currentTarget.style.transition = "";
          e.currentTarget.style.translate = "";
        }}
      >
        <span className="toast-icon">
          {t.icon ?? <ToastIcon tone={tone} />}
        </span>
        {/* The front toast shows up to 3 lines (a long error must be readable,
            QA T3-22); the expanded stack keeps one line per toast. */}
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
                "toast-message text-footnote",
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
            className="toast-action"
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
 * Toast host (docs/DESIGN.md §4 M7). Phone: a black "island" pill that drops from
 * the top on a bouncy spring and widens to fit, swipe up to dismiss. Desktop
 * (≥ 1024 px): a glass card at the bottom right, swipe right to dismiss. Out: rise
 * and fade in 200 ms. Auto-dismiss 3 s (5 s with Undo/action), max 3 stacked as a
 * deck that expands on hover/focus, announced via a polite live region. All motion
 * is CSS (`.toast*` in globals.css). Mount once (see `AppProviders`), then call
 * `toast(...)` anywhere on the client.
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
  const open = expanded && live.length > 1;

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
        data-expanded={open || undefined}
        data-empty={list.length === 0 || undefined}
        onPointerEnter={() => setExpanded(true)}
        onPointerLeave={() => setExpanded(false)}
        onFocusCapture={() => setExpanded(true)}
        onBlurCapture={() => setExpanded(false)}
      >
        {list.map((t, i) => (
          <ToastView
            key={t.id}
            t={t}
            index={i}
            front={i === 0 || open}
            multiline={i === 0 && !open}
          />
        ))}
      </section>
    </>
  );
}
