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

export interface SignaturePadHandle {
  clear(): void;
  isEmpty(): boolean;
  /** PNG data URL (black ink on transparent), or null when empty. */
  toDataURL(): string | null;
  /** PNG blob for upload, or null when empty. */
  toBlob(): Promise<Blob | null>;
}

type Pt = { x: number; y: number; w: number };

/**
 * Signature canvas (SPEC §12.6, ~3 KB): pointer events (finger, pen with
 * pressure, mouse), smoothed quadratic strokes with speed-based width,
 * HiDPI, redraws on resize, PNG export, clear. White "paper" in both themes so
 * the black ink exports correctly. Load lazily (`LazySignaturePad`).
 * Keyboard users need an alternative (typed name) — the SignatureSheet slot provides it.
 */
export function SignaturePad({
  ref,
  onChange,
  height = 180,
  label = "Signature pad",
  disabled,
  className,
}: {
  ref?: Ref<SignaturePadHandle>;
  /** Called with `isEmpty` after each stroke and on clear. */
  onChange?: (isEmpty: boolean) => void;
  height?: number;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Pt[][]>([]);
  const current = useRef<Pt[] | null>(null);
  const last = useRef<{ x: number; y: number; t: number; w: number } | null>(
    null,
  );
  const [empty, setEmpty] = useState(true);

  const ctx = () => canvasRef.current?.getContext("2d") ?? null;

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: ctx/segment only read refs
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const c = ctx();
    if (!canvas || !c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(height * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
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
  }, [height]);

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
    redraw();
    setIsEmpty(true);
  };

  useImperativeHandle(ref, () => ({
    clear,
    isEmpty: () => strokes.current.length === 0,
    toDataURL: () =>
      strokes.current.length
        ? (canvasRef.current?.toDataURL("image/png") ?? null)
        : null,
    toBlob: () =>
      new Promise((resolve) => {
        const canvas = canvasRef.current;
        if (!canvas || !strokes.current.length) return resolve(null);
        canvas.toBlob(resolve, "image/png");
      }),
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
        style={{ height, cursor: "crosshair" }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
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
        className="pointer-events-none absolute inset-x-5 bottom-9 flex items-end gap-2 border-b border-black/25 pb-1 text-[20px] leading-none text-black/35"
      >
        ×
        {empty && (
          <span className="ml-auto text-footnote text-black/40">Sign here</span>
        )}
      </div>
      {!empty && (
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
