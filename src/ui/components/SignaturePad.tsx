"use client";

import {
  type PointerEvent as ReactPointerEvent,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { cx } from "../cx";
import {
  fitBox,
  inkBounds,
  type Pt,
  refit,
  type Size,
  trimRect,
} from "./signature-math";

/** Export options: `trim` crops the PNG to the ink plus a margin. */
export interface SignatureExport {
  trim?: boolean;
}

export interface SignaturePadHandle {
  clear(): void;
  isEmpty(): boolean;
  /** PNG data URL (black ink on transparent), or null when empty. */
  toDataURL(opts?: SignatureExport): string | null;
  /** PNG blob for upload, or null when empty. */
  toBlob(opts?: SignatureExport): Promise<Blob | null>;
  /** Re-measure after the pad's box changed (full screen, rotation). */
  resize(): void;
}

/** Margin kept around the ink when an export is trimmed (CSS px). */
const TRIM_PAD = 12;

/**
 * Signature canvas (SPEC §12.6, ~3 KB): pointer events (finger, pen with
 * pressure, mouse), smoothed quadratic strokes with speed-based width,
 * HiDPI, PNG export (optionally trimmed to the ink), clear. White "paper" in
 * both themes so the black ink exports correctly. `height="fill"` fills its
 * box (full-screen capture); strokes survive a resize: they are drawn scaled
 * to fit, and re-based to the new size when the signer draws again.
 * Load lazily (`LazySignaturePad`, or full screen via `SignatureCapture`).
 * Keyboard users need an alternative (typed name) — the SignatureSheet slot provides it.
 */
export function SignaturePad({
  ref,
  onChange,
  onStart,
  height = 180,
  label = "Signature pad",
  clearButton = true,
  disabled,
  className,
}: {
  ref?: Ref<SignaturePadHandle>;
  /** Called with `isEmpty` after each stroke and on clear. */
  onChange?: (isEmpty: boolean) => void;
  /** A stroke starts (the pen or finger touches the pad). */
  onStart?: () => void;
  /** Canvas height in px, or `fill` (the box's height; give it one). */
  height?: number | "fill";
  label?: string;
  /** The in-pad Clear button (hide it when the host has its own). */
  clearButton?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const fill = height === "fill";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Pt[][]>([]);
  /** The box (CSS px) the strokes are stored in; null while empty. */
  const base = useRef<Size | null>(null);
  const current = useRef<Pt[] | null>(null);
  const last = useRef<{ x: number; y: number; t: number; w: number } | null>(
    null,
  );
  const [empty, setEmpty] = useState(true);

  const ctx = () => canvasRef.current?.getContext("2d") ?? null;

  const size = (): Size => {
    const canvas = canvasRef.current;
    return {
      w: canvas?.clientWidth ?? 0,
      h: fill ? (canvas?.clientHeight ?? 0) : (height as number),
    };
  };

  const segment = (c: CanvasRenderingContext2D, a: Pt, b: Pt, m0: Pt) => {
    // Quadratic through the midpoint for smooth joins.
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    c.lineWidth = (a.w + b.w) / 2;
    c.beginPath();
    c.moveTo(m0.x, m0.y);
    c.quadraticCurveTo(a.x, a.y, mid.x, mid.y);
    c.stroke();
    return { ...mid, w: b.w };
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: segment only reads its args
  const paint = useCallback((c: CanvasRenderingContext2D) => {
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = "#000";
    c.fillStyle = "#000";
    for (const s of strokes.current) {
      const first = s[0];
      if (!first) continue;
      if (s.length === 1) {
        c.beginPath();
        c.arc(first.x, first.y, first.w / 2, 0, Math.PI * 2);
        c.fill();
        continue;
      }
      let m0: Pt = first;
      for (let i = 1; i < s.length; i++) {
        const a = s[i - 1] as Pt;
        const b = s[i] as Pt;
        m0 = segment(c, a, b, m0);
      }
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: ctx/size only read refs and props in deps
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const c = ctx();
    if (!canvas || !c) return;
    const dpr = window.devicePixelRatio || 1;
    const box = size();
    canvas.width = Math.round(box.w * dpr);
    canvas.height = Math.round(box.h * dpr);
    // Strokes stored for another box are drawn scaled to fit this one.
    const f = base.current ? fitBox(base.current, box) : { s: 1, ox: 0, oy: 0 };
    c.setTransform(dpr * f.s, 0, 0, dpr * f.s, dpr * f.ox, dpr * f.oy);
    paint(c);
  }, [height, fill, paint]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    redraw();
    const ro = new ResizeObserver(() => redraw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [redraw]);

  const setIsEmpty = (v: boolean) => {
    setEmpty(v);
    onChange?.(v);
  };

  const clear = () => {
    strokes.current = [];
    base.current = null;
    redraw();
    setIsEmpty(true);
  };

  /** The canvas to export: the pad itself, or the ink alone at the pad's resolution. */
  const exportCanvas = (opts?: SignatureExport): HTMLCanvasElement | null => {
    const canvas = canvasRef.current;
    if (!canvas || !strokes.current.length) return null;
    if (!opts?.trim) return canvas;
    const ink = inkBounds(strokes.current);
    if (!ink) return null;
    const dpr = window.devicePixelRatio || 1;
    const r = trimRect(ink, TRIM_PAD, base.current ?? size());
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(r.w * dpr));
    out.height = Math.max(1, Math.round(r.h * dpr));
    const c = out.getContext("2d");
    if (!c) return canvas;
    c.setTransform(dpr, 0, 0, dpr, -r.x * dpr, -r.y * dpr);
    paint(c);
    return out;
  };

  useImperativeHandle(ref, () => ({
    clear,
    isEmpty: () => strokes.current.length === 0,
    toDataURL: (opts) => exportCanvas(opts)?.toDataURL("image/png") ?? null,
    toBlob: (opts) =>
      new Promise((resolve) => {
        const out = exportCanvas(opts);
        if (!out) return resolve(null);
        out.toBlob(resolve, "image/png");
      }),
    resize: redraw,
  }));

  const point = (e: PointerEvent | ReactPointerEvent): Pt => {
    const r = (canvasRef.current as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const now = e.timeStamp;
    const prev = last.current;
    let w: number;
    if (e.pointerType === "pen" && e.pressure > 0) {
      w = 1 + e.pressure * 3;
    } else if (prev) {
      const v = Math.hypot(x - prev.x, y - prev.y) / Math.max(1, now - prev.t); // px/ms
      const target = Math.max(1.2, Math.min(3.4, 3.6 - v * 1.1));
      w = prev.w * 0.7 + target * 0.3;
    } else {
      w = 2.6;
    }
    last.current = { x, y, t: now, w };
    return { x, y, w };
  };

  return (
    <div
      className={cx(
        "relative overflow-hidden rounded-card bg-white shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`${label}${empty ? " (empty)" : " (signed)"}`}
        className="block w-full touch-none select-none"
        style={{ height: fill ? "100%" : height, cursor: "crosshair" }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          onStart?.();
          // Strokes kept from another size (rotation): move them into this
          // one for good, so new ink lines up with them.
          const box = size();
          const b = base.current;
          if (!strokes.current.length) base.current = box;
          else if (b && (b.w !== box.w || b.h !== box.h)) {
            strokes.current = refit(strokes.current, b, box);
            base.current = box;
            redraw();
          }
          last.current = null;
          const p = point(e);
          current.current = [p];
          strokes.current.push(current.current);
          const c = ctx();
          if (c) {
            c.beginPath();
            c.arc(p.x, p.y, p.w / 2, 0, Math.PI * 2);
            c.fill();
          }
        }}
        onPointerMove={(e) => {
          const s = current.current;
          const c = ctx();
          if (!s || !c) return;
          const events = e.nativeEvent.getCoalescedEvents?.() ?? [
            e.nativeEvent,
          ];
          for (const ev of events.length ? events : [e.nativeEvent]) {
            const p = point(ev);
            const a = s[s.length - 1] as Pt;
            const prevMid: Pt =
              s.length > 1
                ? {
                    x: ((s[s.length - 2] as Pt).x + a.x) / 2,
                    y: ((s[s.length - 2] as Pt).y + a.y) / 2,
                    w: a.w,
                  }
                : a;
            s.push(p);
            segment(c, a, p, prevMid);
          }
        }}
        onPointerUp={() => {
          if (current.current) {
            current.current = null;
            setIsEmpty(false);
          }
        }}
        onPointerCancel={() => {
          current.current = null;
        }}
      />
      {/* Baseline + hint */}
      <div
        aria-hidden
        className={cx(
          "pointer-events-none absolute flex items-end gap-2 border-b border-black/25 pb-1 leading-none text-black/35",
          fill ? "inset-x-[6%] text-[28px]" : "inset-x-5 bottom-9 text-[20px]",
        )}
        style={fill ? { bottom: "max(36px, 24%)" } : undefined}
      >
        ×
        {empty && (
          <span
            className={cx(
              "ml-auto text-black/40",
              fill ? "text-body" : "text-footnote",
            )}
          >
            Sign here
          </span>
        )}
      </div>
      {clearButton && !empty && (
        <button
          type="button"
          onClick={clear}
          className="absolute right-2 top-2 min-h-11 rounded-pill px-3 text-subhead font-medium text-[#0066e0] active:bg-black/5"
        >
          Clear
        </button>
      )}
    </div>
  );
}

export default SignaturePad;
