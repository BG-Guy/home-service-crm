"use client";

import { type ReactNode, useEffect, useId, useState } from "react";
import { getPosition } from "@/client/geo";
import { newId } from "@/lib/ids";
import type { ActionResult } from "@/lib/types";
import { TextField } from "@/ui/components/Field";
import {
  type CapturedSignature,
  SignatureCapture,
} from "@/ui/components/SignatureCapture";
import { toast } from "@/ui/components/Toast";
import type { SignatureDocType, SignatureSubmit } from "./contracts";
import { SignatureUploadError, uploadSignature } from "./upload.client";

// One-step approval (Quote to Paid E4, "Signature: full-screen landscape"): the
// option and total, the signer's name (prefilled, editable), the ESIGN consent text
// with its required checkbox, and the pad on ONE full-screen landscape screen,
// finished with "Approve $450.73". Same record as the S15 sheet: PNG → upload
// (session outbox, or the magic-link route with `publicToken`) → best-effort
// location → the CONSUMER's action with { signerName, esignConsent: true,
// signatureMediaId, geo, deviceTs, clientId } → captureSignature. A lazy chunk.

export interface SignatureApprovalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** e.g. "Sign to approve Better". */
  title: string;
  /** e.g. "$450.73": top right, and in the button ("Approve $450.73"). */
  totalLabel: string;
  docType: SignatureDocType;
  /** The exact e-sign consent text in force (policy `esign_consent`). */
  consentText: string;
  signerNameDefault?: string;
  /** Remote signing: upload through the magic-link route. */
  publicToken?: string;
  /** What is being approved (lines, add-on toggles), shown above the name. */
  summary?: ReactNode;
  action: (
    input: SignatureSubmit,
  ) => Promise<ActionResult<{ signatureId: string }>>;
  onSigned?: (signatureId: string) => void;
  /** Ask for location when signing (default true; never blocks on denial). */
  geo?: boolean;
}

export default function SignatureApproval({
  open,
  onOpenChange,
  title,
  totalLabel,
  docType,
  consentText,
  signerNameDefault = "",
  publicToken,
  summary,
  action,
  onSigned,
  geo: wantGeo = true,
}: SignatureApprovalProps) {
  const [name, setName] = useState(signerNameDefault);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const consentId = useId();
  // Every open starts over: consent is given for this signature only.
  useEffect(() => {
    if (!open) return;
    setConsent(false);
    setError(null);
  }, [open]);

  const submit = async (sig: CapturedSignature): Promise<boolean> => {
    setError(null);
    try {
      const geoPromise = wantGeo
        ? getPosition({ timeoutMs: 5000, maxAgeMs: 120_000 })
        : Promise.resolve(null);
      const [mediaId, geo] = await Promise.all([
        uploadSignature(sig.blob, { publicToken }),
        geoPromise,
      ]);
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
        return false;
      }
      toast({ title: "Approved", tone: "success" });
      onSigned?.(res.data?.signatureId ?? "");
      return true;
    } catch (e) {
      setError(
        e instanceof SignatureUploadError
          ? e.message
          : "Couldn't save the signature. Check your connection and try again.",
      );
      return false;
    }
  };

  return (
    <SignatureCapture
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      subtitle={name.trim() || undefined}
      label={`Signature for ${title}`}
      className="fixed inset-0"
      controls={<span className="num pr-1 text-headline">{totalLabel}</span>}
      doneLabel={`Approve ${totalLabel}`}
      doneDisabled={!consent || name.trim().length < 2}
      savedLabel="Approved"
      onSubmit={submit}
      aside={
        <div className="flex flex-col gap-3">
          {error ? (
            <p role="alert" className="px-1 text-subhead text-danger">
              {error}
            </p>
          ) : null}
          {/* The checkbox first (it must be seen on a short landscape screen),
              the exact consent text right under it in the same card. */}
          <div className="rounded-card bg-card px-3 pb-3 pt-1 shadow-card">
            <label
              htmlFor={consentId}
              className="flex min-h-11 cursor-pointer items-center gap-3"
            >
              <input
                id={consentId}
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.currentTarget.checked)}
                aria-describedby={`${consentId}-text`}
                className="size-6 shrink-0 accent-[var(--accent)]"
              />
              <span className="text-subhead font-semibold">
                I agree to sign electronically
              </span>
            </label>
            <p
              id={`${consentId}-text`}
              className="whitespace-pre-line text-footnote text-label-2"
            >
              {consentText}
            </p>
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
          {summary}
          <p className="px-1 text-caption text-label-3">
            {docType === "estimate" || docType === "change_order"
              ? "We record the time, your device and approximate location with your signature to protect you and us."
              : "The time and your device are recorded with your signature."}
          </p>
        </div>
      }
    />
  );
}
