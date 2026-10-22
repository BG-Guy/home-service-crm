"use client";

import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cx } from "../cx";
import { Button } from "./Button";
import { FullscreenHub } from "./FullscreenHub";
import { SignaturePad, type SignaturePadHandle } from "./SignaturePad";
import { SuccessCheck } from "./SuccessCheck";

/** A signature from `SignatureCapture`: the trimmed PNG, black ink on transparent. */
export interface CapturedSignature {
  /** For upload (the same bytes every time it is read). */
  blob: Blob;
  /** The same image as a data URL, for a preview. */
  dataUrl: string;
}

export interface SignatureCaptureProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The signer tapped Done. */
  onDone: (signature: CapturedSignature) => void;
  /** Top-bar title (default "Customer signature") and an optional line under it. */
  title?: ReactNode;
  subtitle?: ReactNode;
  /** The pad's accessible name. */
  label?: string;
  /** `?fs=` value while open (default "sign"). */
  historyKey?: string;
  /** The in-page box it grows from and shrinks back into (e.g. `absolute inset-0` over a field). */
  className?: string;
}

// The rotate tip invites a turn before anyone signs: gone from the first stroke.
const CSS = `.sigcap{visibility:hidden;pointer-events:none}
.sigcap>.fs-slot{height:100%}
.sigcap .fs-hub[data-fs]{visibility:visible;pointer-events:auto}
.sigcap .sigcap-pad{position:absolute;inset:12px calc(12px + env(safe-area-inset-right)) 12px calc(12px + env(safe-area-inset-left))}
.sigcap[data-touched] .fs-tip,.sigcap[data-touched] .fs-hint{display:none}
.sigcap-ok{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgb(255 255 255/.88);color:#1d1d1f;font-size:17px;line-height:22px;font-weight:600}`;

/**
 * Full-screen signature capture (DESIGN.md "Fullscreen hub (M19)", use 3): a
 * `FullscreenHub` with no trigger around a `SignaturePad` that fills the
 * screen. Landscape tip on phones held upright (until the first stroke), nothing scrolls or
 * pulls-to-refresh while signing (`lockScroll="strict"`), Clear and Done in
 * the footer; strokes survive a rotation (the pad re-fits them). Done hands
 * back a PNG trimmed to the ink, shows a short inline confirmation, then
 * closes. Esc, back and the close button cancel (nothing is handed back).
 * Every open starts with a clean pad.
 *
 * It works inside a Sheet (a `<dialog>`): Esc closes the capture, not the sheet.
 * Usually opened by `SignatureField`, which loads it on demand.
 */
export function SignatureCapture({
  open,
  onOpenChange,
  onDone,
  title = "Customer signature",
  subtitle,
  label = "Signature",
  historyKey = "sign",
  className,
}: SignatureCaptureProps) {
  const pad = useRef<SignaturePadHandle>(null);
  const [empty, setEmpty] = useState(true);
  const [touched, setTouched] = useState(false);
  const [state, setState] = useState<"draw" | "saving" | "saved">("draw");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const live = useRef(onOpenChange);
  live.current = onOpenChange;

  // A fresh pad on every open.
  useLayoutEffect(() => {
    if (!open) return;
    clearTimeout(timer.current);
    pad.current?.clear();
    setTouched(false);
    setState("draw");
  }, [open]);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Inside a sheet, Esc would close the <dialog> under us: cancel signing
  // instead (the hub ignores Esc while a dialog is open).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      live.current(false);
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [open]);

  const done = async () => {
    const p = pad.current;
    if (!p || p.isEmpty() || state !== "draw") return;
    setState("saving");
    const blob = await p.toBlob({ trim: true });
    const dataUrl = p.toDataURL({ trim: true });
    if (!blob || !dataUrl) {
      setState("draw");
      return;
    }
    onDone({ blob, dataUrl });
    setState("saved");
    timer.current = setTimeout(() => live.current(false), 700);
  };

  return (
    <div
      className={cx("sigcap", className)}
      data-touched={touched || state !== "draw" ? "" : undefined}
    >
      <style href="signature-capture" precedence="default">
        {CSS}
      </style>
      <FullscreenHub
        open={open}
        onOpenChange={onOpenChange}
        trigger="none"
        title={title}
        subtitle={subtitle}
        label={typeof title === "string" ? title : label}
        historyKey={historyKey}
        orientationHint="landscape"
        lockScroll="strict"
        // Browser full screen would lift the page root over the sheet this
        // usually sits in; the hub alone already covers the screen.
        browserFullscreen={false}
        closeLabel="Cancel signing"
        onResize={() => pad.current?.resize()}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={empty || state !== "draw"}
              onClick={() => pad.current?.clear()}
            >
              Clear
            </Button>
            <Button
              disabled={empty || state === "saved"}
              loading={state === "saving"}
              onClick={done}
            >
              Done
            </Button>
          </>
        }
      >
        <SignaturePad
          ref={pad}
          height="fill"
          clearButton={false}
          label={label}
          onChange={setEmpty}
          onStart={() => setTouched(true)}
          className="sigcap-pad"
        />
        {state === "saved" ? (
          <output className="sigcap-ok">
            <SuccessCheck size={64} label="Signature added" />
            Signature added
          </output>
        ) : null}
      </FullscreenHub>
    </div>
  );
}

export default SignatureCapture;
