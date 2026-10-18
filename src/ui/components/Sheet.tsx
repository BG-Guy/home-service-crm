"use client";

import {
  createContext,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cx } from "../cx";
import {
  createVelocityTracker,
  type SpringAnimation,
  springTo,
} from "../motion/spring-driver";
import {
  EASE,
  prefersReducedMotion,
  project,
  rubberBand,
  spring,
} from "../motion/springs";
import { Alert } from "./Alert";
import { isDesktop, lockScroll, trackVisualViewport } from "./dialog-utils";

/**
 * Detent: `medium` (half height), `large` (full height), `content` (fits its
 * content, up to large), or a number = fraction of the viewport height (0–1].
 */
export type Detent = "medium" | "large" | "content" | number;

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Inline title in the sheet's nav bar (17 px semibold). */
  title?: ReactNode;
  /** Accessible name when there is no visible `title`. */
  label?: string;
  /** Leading header slot (e.g. a plain "Cancel" button). */
  leading?: ReactNode;
  /** Trailing header slot (e.g. a bold "Done"/"Save" button). */
  trailing?: ReactNode;
  /** Detents, smallest first. Default `['large']`. */
  detents?: readonly Detent[];
  /** Index into `detents` to open at. Default 0. */
  initialDetent?: number;
  /** When true, dismissing asks "Discard changes?" first. */
  dirty?: boolean;
  /** Copy for the discard confirmation. */
  discardConfirm?: {
    title?: string;
    message?: string;
    discardLabel?: string;
    keepLabel?: string;
  };
  /** Allow drag/scrim/Esc dismissal (default true). */
  dismissible?: boolean;
  /** Desktop (≥ 1024 px) presentation: centered `modal` (default) or right `panel`. */
  desktop?: "modal" | "panel";
  /** Sticky footer (e.g. a primary button); sits above the safe area / keyboard. */
  footer?: ReactNode;
  /** No panel chrome (used by ActionSheet). */
  bare?: boolean;
  /** Called after the exit animation finishes. */
  onClosed?: () => void;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}

interface SheetControls {
  /** Request dismissal (honors `dirty` / `dismissible`). */
  close: () => void;
  /** Move to a detent by index. */
  setDetent: (index: number) => void;
}

const SheetContext = createContext<SheetControls | null>(null);

/** Inside a Sheet: `const { close } = useSheetControls()`. */
export function useSheetControls(): SheetControls {
  const ctx = useContext(SheetContext);
  if (!ctx) throw new Error("useSheetControls must be used inside <Sheet>");
  return ctx;
}

/** Convenience state for a sheet: `<Sheet {...sheet.props}>` + `sheet.show()`. */
export function useSheetState(initial = false) {
  const [open, setOpen] = useState(initial);
  return {
    open,
    setOpen,
    show: useCallback(() => setOpen(true), []),
    hide: useCallback(() => setOpen(false), []),
    props: { open, onOpenChange: setOpen },
  };
}

const DEFAULT_DETENTS: readonly Detent[] = ["large"];

type Mode = "sheet" | "modal" | "panel";
interface Geometry {
  offsets: number[];
  closed: number;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

function offsetFor(d: Detent, H: number, vh: number): number {
  if (d === "large" || d === "content") return 0;
  const frac = d === "medium" ? 0.5 : d;
  return clamp(H - vh * frac, 0, H);
}

/**
 * iOS sheet (SPEC §12.6) on a native `<dialog>.showModal()`:
 * - detents (`medium` / `large` / `content` / fraction), grabber tap cycles detents;
 * - drag the grabber/header to resize or dismiss; release uses the finger's
 *   velocity, projects the resting point (UIScrollView deceleration) and settles
 *   with a real spring (`spring.sheet`) — dismisses when the projection passes 50 %;
 * - scrolling the body at a smaller detent expands to the largest one;
 * - confirm-on-dirty, Esc, scrim tap, focus containment (native dialog), focus
 *   restore, page scroll lock, keyboard-aware via `visualViewport`;
 * - desktop ≥ 1024 px: centered modal (max 560 px) or right-side panel;
 * - reduced motion: crossfades instead of sliding.
 *
 * Sheets may stack (a picker sheet over a form sheet); each is its own top-layer dialog.
 *
 * ```tsx
 * const sheet = useSheetState();
 * <Button onClick={sheet.show}>New note</Button>
 * <Sheet {...sheet.props} title="New note" detents={["medium", "large"]} dirty={text !== ""}
 *   leading={<Button variant="plain" size="sm" onClick={sheet.hide}>Cancel</Button>}>
 *   …
 * </Sheet>
 * ```
 */
export function Sheet(props: SheetProps) {
  const {
    open,
    title,
    label,
    leading,
    trailing,
    detents = DEFAULT_DETENTS,
    initialDetent = 0,
    discardConfirm,
    desktop = "modal",
    footer,
    bare,
    className,
    bodyClassName,
    children,
  } = props;

  const [mounted, setMounted] = useState(open);
  const [confirmOpen, setConfirmOpen] = useState(false);
  if (open && !mounted) setMounted(true);

  const latest = useRef(props);
  latest.current = props;

  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const y = useRef(0);
  const geo = useRef<Geometry>({ offsets: [0], closed: 1000 });
  const mode = useRef<Mode>("sheet");
  const detentIdx = useRef(initialDetent);
  const anim = useRef<SpringAnimation | null>(null);
  const waapi = useRef<Animation[]>([]);
  const closeVelocity = useRef(0);
  const drag = useRef<{
    id: number;
    startY: number;
    startOff: number;
    moved: boolean;
    onGrabber: boolean;
  } | null>(null);
  const tracker = useRef(createVelocityTracker());
  const titleId = useId();

  const fit = bare || (detents.length === 1 && detents[0] === "content");

  /* ---------- geometry + rendering of the drag offset ---------- */

  const measure = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const H = panel.offsetHeight;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const ds = latest.current.detents ?? DEFAULT_DETENTS;
    geo.current = {
      offsets:
        mode.current === "sheet" && !latest.current.bare
          ? ds.map((d) => offsetFor(d, H, vh))
          : [0],
      closed: H + 24,
    };
    detentIdx.current = clamp(
      detentIdx.current,
      0,
      geo.current.offsets.length - 1,
    );
  }, []);

  const apply = useCallback((value: number) => {
    y.current = value;
    const panel = panelRef.current;
    const scrim = scrimRef.current;
    if (!panel || !scrim) return;
    panel.style.transform = `translate3d(0, ${value}px, 0)`;
    const { offsets, closed } = geo.current;
    const lowest = Math.max(...offsets);
    const t = clamp((value - lowest) / Math.max(1, closed - lowest), 0, 1);
    scrim.style.opacity = String(1 - t);
  }, []);

  const animateTo = useCallback(
    (target: number, velocity = 0) => {
      anim.current?.stop();
      const a = springTo({
        from: y.current,
        to: target,
        velocity,
        spring: spring.sheet,
        onUpdate: apply,
      });
      anim.current = a;
      return a.finished;
    },
    [apply],
  );

  const cancelWaapi = () => {
    for (const a of waapi.current) a.cancel();
    waapi.current = [];
  };

  const setDetent = useCallback(
    (i: number) => {
      if (mode.current !== "sheet") return;
      const { offsets } = geo.current;
      detentIdx.current = clamp(i, 0, offsets.length - 1);
      animateTo(offsets[detentIdx.current] ?? 0);
    },
    [animateTo],
  );

  const topIndex = () => {
    const { offsets } = geo.current;
    return offsets.indexOf(Math.min(...offsets));
  };

  /* ---------- dismissal ---------- */

  const requestClose = useCallback(
    (velocity = 0) => {
      const p = latest.current;
      const back = () => {
        if (mode.current === "sheet")
          animateTo(geo.current.offsets[detentIdx.current] ?? 0, velocity);
      };
      if (p.dismissible === false) return back();
      if (p.dirty) {
        back();
        setConfirmOpen(true);
        return;
      }
      closeVelocity.current = velocity;
      p.onOpenChange(false);
    },
    [animateTo],
  );

  /* ---------- open ---------- */

  // biome-ignore lint/correctness/useExhaustiveDependencies: refs + stable callbacks; runs per open
  useLayoutEffect(() => {
    if (!mounted || !open) return;
    const dialog = dialogRef.current;
    const panel = panelRef.current;
    const scrim = scrimRef.current;
    if (!dialog || !panel || !scrim) return;

    const p = latest.current;
    mode.current = p.bare
      ? "sheet"
      : isDesktop()
        ? (p.desktop ?? "modal") === "panel"
          ? "panel"
          : "modal"
        : "sheet";
    const wasOpen = dialog.open;
    // showModal() focuses an [autofocus] descendant, else the first button (the
    // header's Cancel, with a focus ring: QA T4-32). Point it at the panel, or at
    // the content's data-autofocus element, so nothing else flashes focus.
    if (!wasOpen) {
      const auto = panel.querySelector<HTMLElement>("[data-autofocus]");
      for (const el of dialog.querySelectorAll("[autofocus]"))
        el.removeAttribute("autofocus");
      (auto ?? panel).setAttribute("autofocus", "");
      dialog.showModal();
    }
    // Fallback for browsers without overflow: clip — undo focus-into-view scrolling.
    const unscroll = () => {
      if (dialog.scrollTop || dialog.scrollLeft) dialog.scrollTo(0, 0);
    };
    unscroll();
    dialog.addEventListener("scroll", unscroll);
    const unlock = lockScroll();
    cancelWaapi();
    measure();
    if (!wasOpen) {
      detentIdx.current = clamp(
        p.initialDetent ?? 0,
        0,
        geo.current.offsets.length - 1,
      );
    }
    const target = geo.current.offsets[detentIdx.current] ?? 0;
    const reduced = prefersReducedMotion();

    if (mode.current === "sheet") {
      if (reduced) {
        anim.current?.stop();
        apply(target);
        if (!wasOpen) {
          waapi.current = [
            panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 }),
            scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 }),
          ];
        }
      } else {
        if (!wasOpen) apply(geo.current.closed);
        animateTo(target);
      }
    } else {
      anim.current?.stop();
      panel.style.transform = "none";
      scrim.style.opacity = "1";
      if (!reduced) {
        waapi.current = [
          panel.animate(
            mode.current === "modal"
              ? [
                  { opacity: 0, transform: "scale(0.96)" },
                  { opacity: 1, transform: "none" },
                ]
              : [{ transform: "translateX(100%)" }, { transform: "none" }],
            { duration: 450, easing: EASE.snappy },
          ),
          scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 }),
        ];
      }
    }

    // Initial focus: an element marked data-autofocus, else the panel itself
    // (so iOS doesn't pop the keyboard for the first input).
    if (!wasOpen) {
      const auto = panel.querySelector<HTMLElement>("[data-autofocus]");
      (auto ?? panel).focus({ preventScroll: true });
    }

    let kbWas = false;
    const untrack = trackVisualViewport(dialog, (kb) => {
      if (kb === kbWas) return;
      kbWas = kb;
      measure();
      if (mode.current !== "sheet") return;
      if (kb) detentIdx.current = topIndex();
      animateTo(geo.current.offsets[detentIdx.current] ?? 0);
    });
    const onResize = () => {
      measure();
      if (mode.current === "sheet")
        apply(geo.current.offsets[detentIdx.current] ?? 0);
    };
    window.addEventListener("resize", onResize);
    return () => {
      untrack();
      unlock();
      dialog.removeEventListener("scroll", unscroll);
      window.removeEventListener("resize", onResize);
    };
  }, [mounted, open, measure, apply, animateTo]);

  /* ---------- close ---------- */

  // biome-ignore lint/correctness/useExhaustiveDependencies: refs + stable callbacks; runs per close
  useEffect(() => {
    if (open || !mounted) return;
    const dialog = dialogRef.current;
    const panel = panelRef.current;
    const scrim = scrimRef.current;
    let cancelled = false;
    const finish = () => {
      if (cancelled) return;
      if (dialog?.open) dialog.close();
      setMounted(false);
      latest.current.onClosed?.();
    };
    if (!dialog || !panel || !scrim || !dialog.open) {
      finish();
      return;
    }
    const v = closeVelocity.current;
    closeVelocity.current = 0;
    cancelWaapi();
    const reduced = prefersReducedMotion();
    if (mode.current === "sheet" && !reduced) {
      animateTo(geo.current.closed, v).then((done) => done && finish());
    } else {
      anim.current?.stop();
      const opts = {
        duration: reduced ? 150 : 200,
        easing: "ease-out",
        fill: "forwards" as const,
      };
      const a = panel.animate(
        mode.current === "panel" && !reduced
          ? [{ transform: "none" }, { transform: "translateX(100%)" }]
          : mode.current === "modal" && !reduced
            ? [
                { opacity: 1, transform: "none" },
                { opacity: 0, transform: "scale(0.96)" },
              ]
            : [{ opacity: 1 }, { opacity: 0 }],
        opts,
      );
      waapi.current = [
        a,
        scrim.animate([{ opacity: 1 }, { opacity: 0 }], opts),
      ];
      a.finished.then(finish, () => {});
    }
    return () => {
      cancelled = true;
    };
  }, [open, mounted, animateTo]);

  useEffect(
    () => () => {
      anim.current?.stop();
    },
    [],
  );

  /* ---------- drag ---------- */

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (mode.current !== "sheet" || bare || e.button !== 0) return;
    const target = e.target as Element;
    const onGrabber = !!target.closest("[data-grabber]");
    if (
      !onGrabber &&
      target.closest("button, a, input, select, textarea, [role=button]")
    )
      return;
    anim.current?.stop();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      id: e.pointerId,
      startY: e.clientY,
      startOff: y.current,
      moved: false,
      onGrabber,
    };
    tracker.current.reset();
    tracker.current.add(y.current);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dy) < 4) return;
    d.moved = true;
    const { offsets } = geo.current;
    const minOff = Math.min(...offsets);
    const maxOff = Math.max(...offsets);
    let next = d.startOff + dy;
    if (next < minOff) next = minOff - rubberBand(minOff - next, 60);
    else if (latest.current.dismissible === false && next > maxOff)
      next = maxOff + rubberBand(next - maxOff, 120);
    apply(next);
    tracker.current.add(next);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const { offsets, closed } = geo.current;
    if (!d.moved) {
      if (d.onGrabber && offsets.length > 1)
        setDetent((detentIdx.current + 1) % offsets.length);
      else animateTo(offsets[detentIdx.current] ?? 0);
      return;
    }
    const v = e.type === "pointercancel" ? 0 : tracker.current.velocity();
    const projected = project(y.current, v);
    const maxOff = Math.max(...offsets);
    if (projected > maxOff + (closed - maxOff) * 0.5) {
      requestClose(v);
      return;
    }
    let best = 0;
    offsets.forEach((o, i) => {
      if (Math.abs(o - projected) < Math.abs((offsets[best] ?? 0) - projected))
        best = i;
    });
    detentIdx.current = best;
    animateTo(offsets[best] ?? 0, v);
  };

  const controls = useMemo<SheetControls>(
    () => ({ close: () => requestClose(0), setDetent }),
    [requestClose, setDetent],
  );

  if (!mounted) return null;

  const hasHeader = title != null || leading != null || trailing != null;
  const dc = discardConfirm ?? {};

  return (
    <SheetContext.Provider value={controls}>
      <dialog
        ref={dialogRef}
        className="sheet"
        aria-labelledby={title != null ? titleId : undefined}
        aria-label={title == null ? label : undefined}
        onCancel={(e) => {
          e.preventDefault();
          requestClose(0);
        }}
        onClose={() => {
          // Closed natively (e.g. repeated Esc): sync the parent.
          if (latest.current.open) latest.current.onOpenChange(false);
        }}
      >
        <div
          ref={scrimRef}
          aria-hidden
          className="sheet-scrim"
          onClick={() => requestClose(0)}
        />
        <div
          ref={panelRef}
          tabIndex={-1}
          className={cx("sheet-panel outline-none", className)}
          data-fit={fit || undefined}
          data-bare={bare || undefined}
          data-desktop={desktop}
        >
          {bare ? (
            children
          ) : (
            <>
              <div
                className="sheet-grab shrink-0"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                <div className="sheet-grab-handle flex justify-center pt-[5px] lg:hidden">
                  {detents.length > 1 ? (
                    <button
                      type="button"
                      data-grabber
                      aria-label="Resize sheet"
                      onClick={(e) => {
                        // Keyboard activation only; pointer taps are handled on pointerup.
                        if (e.detail === 0)
                          setDetent(
                            (detentIdx.current + 1) %
                              geo.current.offsets.length,
                          );
                      }}
                      className="relative h-[5px] w-9 rounded-full bg-label-3 before:absolute before:-inset-x-4 before:-inset-y-3 before:content-['']"
                    />
                  ) : (
                    <span
                      data-grabber
                      aria-hidden
                      className="h-[5px] w-9 rounded-full bg-label-3"
                    />
                  )}
                </div>
                {hasHeader ? (
                  <div className="grid min-h-[52px] grid-cols-[1fr_auto_1fr] items-center gap-2 px-4">
                    <div className="flex min-w-0 justify-start">{leading}</div>
                    <h2
                      id={titleId}
                      className="max-w-[60vw] truncate text-center text-headline lg:max-w-[340px]"
                    >
                      {title}
                    </h2>
                    <div className="flex min-w-0 justify-end">{trailing}</div>
                  </div>
                ) : (
                  <div className="h-3" />
                )}
              </div>
              <div
                className={cx("sheet-body px-4", bodyClassName)}
                onScroll={(e) => {
                  if (
                    mode.current === "sheet" &&
                    e.currentTarget.scrollTop > 0 &&
                    y.current > Math.min(...geo.current.offsets) + 1 &&
                    !drag.current &&
                    detentIdx.current !== topIndex()
                  ) {
                    setDetent(topIndex());
                  }
                }}
              >
                {children}
              </div>
              {footer && (
                <div className="hairline-t shrink-0 bg-[var(--sheet-bg)] px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3">
                  {footer}
                </div>
              )}
            </>
          )}
        </div>
      </dialog>
      <Alert
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={dc.title ?? "Discard changes?"}
        message={dc.message ?? "Your changes will be lost."}
        actions={[
          { label: dc.keepLabel ?? "Keep editing", style: "cancel" },
          {
            label: dc.discardLabel ?? "Discard changes",
            style: "destructive",
            onPress: () => {
              closeVelocity.current = 0;
              latest.current.onOpenChange(false);
            },
          },
        ]}
      />
    </SheetContext.Provider>
  );
}
