"use client";

import { PenLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { getPosition } from "@/client/geo";
import { newId } from "@/lib/ids";
import { Button } from "@/ui/components/Button";
import { TextField } from "@/ui/components/Field";
import { LazySignaturePad } from "@/ui/components/lazy";
import { Sheet } from "@/ui/components/Sheet";
import type { SignaturePadHandle } from "@/ui/components/SignaturePad";
import { toast } from "@/ui/components/Toast";
import type { SignatureSheetProps } from "./contracts";
import { SignatureUploadError, uploadSignature } from "./upload.client";

// Client UI slot S15 (BUILD_PLAN §5.1): ESIGN consent checkbox, typed name and the
// UI-kit SignaturePad (lazy chunk). On "Sign": PNG → upload (session outbox, or the
// public magic-link route when `publicToken` is set) → best-effort geolocation →
// the CONSUMER's server action with { signerName, esignConsent, signatureMediaId,
// geo, deviceTs, clientId }. The consumer's action calls B3 captureSignature.

export function SignatureSheet({
  title,
  docType,
  consentText,
  summaryLines,
  signerNameDefault = "",
  publicToken,
  action,
  triggerLabel = "Sign",
  doneHref,
  triggerVariant = "filled",
  fullWidth,
  size = "lg",
  open: openProp,
  onOpenChange,
  onSigned,
  geo: wantGeo = true,
}: SignatureSheetProps & {
  /** Optional (B3 additions). */
  triggerVariant?: "filled" | "tinted" | "gray";
  fullWidth?: boolean;
  size?: "md" | "lg";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSigned?: (signatureId: string) => void;
  /** Ask for location when signing (default true; never blocks on denial). */
  geo?: boolean;
}) {
  const router = useRouter();
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const setOpen = (v: boolean) => {
    if (!controlled) setOpenState(v);
    onOpenChange?.(v);
  };
  const pad = useRef<SignaturePadHandle>(null);
  const [name, setName] = useState(signerNameDefault);
  const [consent, setConsent] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [busy, setBusy] = useState<null | string>(null);
  const [error, setError] = useState<string | null>(null);
  const consentId = useId();
  const ready = consent && drawn && name.trim().length >= 2 && !busy;

  const submit = async () => {
    if (!ready) return;
    setError(null);
    try {
      setBusy("Saving signature…");
      const blob = await pad.current?.toBlob();
      if (!blob) throw new SignatureUploadError("Draw your signature first.");
      const geoPromise = wantGeo
        ? getPosition({ timeoutMs: 5000, maxAgeMs: 120_000 })
        : Promise.resolve(null);
      const [mediaId, geo] = await Promise.all([
        uploadSignature(blob, { publicToken }),
        geoPromise,
      ]);
      setBusy("Signing…");
      const res = await action({
        signerName: name.trim(),
        esignConsent: true,
        signatureMediaId: mediaId,
        geo: geo
          ? {
              lat: geo.lat,
              lng: geo.lng,
              accuracyM: geo.accuracyM ?? null,
              at: geo.at,
            }
          : null,
        deviceTs: new Date().toISOString(),
        clientId: newId(),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast({ title: "Signed", tone: "success" });
      setOpen(false);
      if (res.data?.signatureId) onSigned?.(res.data.signatureId);
      if (doneHref) router.push(doneHref);
    } catch (e) {
      setError(
        e instanceof SignatureUploadError
          ? e.message
          : "Couldn't save the signature. Check your connection and try again.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {!controlled && (
        <Button
          type="button"
          size={size}
          variant={triggerVariant}
          fullWidth={fullWidth}
          icon={<PenLine aria-hidden size={19} />}
          onClick={() => setOpen(true)}
        >
          {triggerLabel}
        </Button>
      )}
      <Sheet
        open={open}
        onOpenChange={(v) => !busy && setOpen(v)}
        title={title}
        detents={["large"]}
        dismissible={!busy}
        dirty={drawn}
        discardConfirm={{
          title: "Discard signature?",
          message: "Your signature won't be saved.",
        }}
        leading={
          <Button
            variant="plain"
            size="sm"
            disabled={!!busy}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
        }
        footer={
          <div className="px-[var(--gutter)] pb-2 pt-2">
            <Button
              size="lg"
              fullWidth
              disabled={!ready}
              loading={!!busy}
              onClick={submit}
            >
              {busy ?? "Sign"}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4 px-[var(--gutter)] pb-6">
          {summaryLines && summaryLines.length > 0 && (
            <ul className="list-card">
              {summaryLines.map((l) => (
                <li key={l} className="list-row px-4 py-[11px] text-body">
                  {l}
                </li>
              ))}
            </ul>
          )}
          <div className="rounded-card bg-card p-4 shadow-card">
            <p className="whitespace-pre-line text-subhead text-label-2">
              {consentText}
            </p>
            <label
              htmlFor={consentId}
              className="mt-3 flex min-h-11 cursor-pointer items-center gap-3"
            >
              <input
                id={consentId}
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.currentTarget.checked)}
                className="size-6 shrink-0 accent-[var(--accent)]"
              />
              <span className="text-body">I agree to sign electronically</span>
            </label>
          </div>
          <TextField
            label="Full name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            autoComplete="name"
            autoCapitalize="words"
            placeholder="Type your full name"
            maxLength={200}
          />
          <div>
            <p className="px-1 pb-1.5 text-footnote font-medium text-label-2">
              Signature
            </p>
            <LazySignaturePad
              ref={pad}
              onChange={(empty: boolean) => setDrawn(!empty)}
              label={`Signature for ${title}`}
            />
          </div>
          {error && (
            <p role="alert" className="px-1 text-subhead text-danger">
              {error}
            </p>
          )}
          <p className="px-1 text-caption text-label-3">
            {docType === "estimate" || docType === "change_order"
              ? "We record the time, your device and approximate location with your signature to protect you and us."
              : "The time and your device are recorded with your signature."}
          </p>
        </div>
      </Sheet>
    </>
  );
}
