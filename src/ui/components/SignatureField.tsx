"use client";

import { PenLine } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { cx } from "../cx";
import { dropStaleFullscreenParam } from "./fullscreen-url";
import { preloadable } from "./preloadable";
import type { CapturedSignature } from "./SignatureCapture";

export type { CapturedSignature } from "./SignatureCapture";

// The full-screen capture (FullscreenHub + SignaturePad) is its own chunk,
// warmed when the field shows and loaded for sure on the first touch.
const SignatureCapture = preloadable(() =>
  import("./SignatureCapture").then((m) => m.SignatureCapture),
);
const warm = () => void SignatureCapture.preload().catch(() => {});

/**
 * A signature form field: a paper-white box that reads "Tap to sign", or
 * shows the signature once there is one. Tapping it opens `SignatureCapture`
 * full screen, growing out of the box and shrinking back into it on Done.
 *
 * ```tsx
 * const [sig, setSig] = useState<CapturedSignature | null>(null);
 * <SignatureField value={sig} onChange={setSig} title="Approve E-1042" subtitle={name} />
 * // upload sig.blob (PNG) when the form is sent
 * ```
 */
export function SignatureField({
  value,
  onChange,
  title,
  subtitle,
  label = "Signature",
  disabled,
  className,
}: {
  value: CapturedSignature | null;
  onChange: (signature: CapturedSignature) => void;
  /** The capture's top-bar title and subtitle. */
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Accessible name of the field and the pad. */
  label?: string;
  disabled?: boolean;
  /** Size and place of the box (default 160 px high, full width). */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Mounted on first use, then kept (its close animation needs it).
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const id = setTimeout(warm, 600);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className={cx("relative h-40", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-label={value ? `${label}: signed. Tap to sign again` : label}
        onPointerDown={warm}
        onClick={() => {
          dropStaleFullscreenParam("sign");
          setArmed(true);
          setOpen(true);
        }}
        className="pressable relative flex size-full flex-col items-center justify-center gap-1.5 overflow-hidden rounded-card bg-white text-black/45 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)] outline-offset-2 disabled:opacity-50"
      >
        {value ? (
          <>
            {/* biome-ignore lint/performance/noImgElement: local data URL preview */}
            <img
              src={value.dataUrl}
              alt=""
              className="absolute inset-x-4 inset-y-3 m-auto max-h-[calc(100%-40px)] max-w-[calc(100%-32px)] object-contain"
            />
            <span className="absolute bottom-2 right-3 text-footnote font-medium text-[#0066e0]">
              Sign again
            </span>
          </>
        ) : (
          <>
            <PenLine aria-hidden size={26} strokeWidth={1.8} />
            <span className="text-body font-medium text-black/60">
              Tap to sign
            </span>
            <span
              aria-hidden
              className="absolute inset-x-5 bottom-7 border-b border-black/20"
            />
          </>
        )}
      </button>
      {armed ? (
        <SignatureCapture
          open={open}
          onOpenChange={setOpen}
          onDone={onChange}
          title={title}
          subtitle={subtitle}
          label={label}
          className="absolute inset-0"
        />
      ) : null}
    </div>
  );
}
