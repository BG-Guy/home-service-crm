"use client";

import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cx } from "../cx";

/**
 * Top-layer popover (`popover="manual"`) under — or, without room, above — its
 * anchor. Own light dismiss: outside pointer, Esc (focus returns to the anchor),
 * focus leaving it. Follows the anchor on scroll / resize.
 */
export function AnchoredPopover({
  open,
  onClose,
  anchorRef,
  label,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const place = useCallback(() => {
    const el = ref.current;
    const anchor = anchorRef.current;
    if (!el || !anchor) return;
    // A field's trigger hangs the popover from the whole field box.
    const a =
      anchor.dataset.popoverAnchor === "parent"
        ? (anchor.parentElement ?? anchor)
        : anchor;
    const r = a.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const below = r.bottom + 8 + h <= vh - 8 || r.top - 8 - h < 8;
    const left = Math.min(Math.max(8, r.left), vw - w - 8);
    const top = below ? r.bottom + 8 : r.top - 8 - h;
    el.style.left = `${left}px`;
    el.style.top = `${Math.max(8, top)}px`;
    el.dataset.side = below ? "bottom" : "top";
    el.style.transformOrigin = `${Math.min(Math.max(16, r.left + 24 - left), w - 16)}px ${below ? "0" : "100%"}`;
  }, [anchorRef]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !mounted) return;
    if (open) {
      if (!el.matches(":popover-open")) el.showPopover();
      place();
    } else if (el.matches(":popover-open")) {
      const hadFocus = el.contains(document.activeElement);
      el.hidePopover();
      if (hadFocus) anchorRef.current?.focus({ preventScroll: true });
    }
  }, [open, mounted, place, anchorRef]);

  // Unmount the content after the exit transition.
  useEffect(() => {
    if (open || !mounted) return;
    const t = setTimeout(() => setMounted(false), 260);
    return () => clearTimeout(t);
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const follow = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      anchorRef.current?.focus({ preventScroll: true });
      closeRef.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open, place, anchorRef]);

  if (!mounted) return null;
  return (
    <div
      ref={ref}
      popover="manual"
      role="dialog"
      aria-label={label}
      className={cx("picker-pop", className)}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (
          next &&
          !ref.current?.contains(next) &&
          !anchorRef.current?.contains(next)
        )
          closeRef.current();
      }}
    >
      {children}
    </div>
  );
}
