"use client";

import {
  CircleCheck,
  CircleDashed,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { TextArea } from "@/ui/components/Field";
import { Sheet } from "@/ui/components/Sheet";
import { ToggleRow } from "@/ui/components/Toggle";
import { toneStyle } from "@/ui/tone";
import type { GuardMiss } from "../../machine";

/**
 * Start / Complete sheet (SPEC M06 "Complete shows readiness checklist sheet with
 * missing items"): readiness ring (S22), every missing requirement with its fix
 * (camera S24, signature S15, deposit S19, estimate, checklist, start approval),
 * and the jobs.override_requirements bypass with a reason.
 */
export default function RequirementsSheet({
  open,
  onOpenChange,
  mode,
  jobId,
  missing,
  canOverride,
  pending,
  onSubmit,
  readinessSlot,
  signatureNode,
  cameraNode,
  collectNode,
  onRequestApproval,
  approvalPending,
  signed,
  invoiceEmpty,
  recommendPhotos,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "start" | "complete";
  jobId: string;
  missing: GuardMiss[];
  canOverride: boolean;
  pending: boolean;
  onSubmit: (overrideReason: string | null) => void;
  readinessSlot?: ReactNode;
  signatureNode?: ReactNode;
  cameraNode?: ReactNode;
  collectNode?: ReactNode;
  onRequestApproval?: () => void;
  approvalPending?: boolean;
  /** A completion signature is on file (the Recommended row shows "Signed"). */
  signed?: boolean;
  /** Complete: the draft invoice has no lines yet (it stays a draft; QA T1-02). */
  invoiceEmpty?: boolean;
  /** Complete: label of a recommended (not required) photos row, or null. */
  recommendPhotos?: string | null;
}) {
  // Latched for this sheet: a photo upload refreshes the page (and the counts), and
  // the row with its camera tray shouldn't vanish mid-batch. Once the refreshed
  // counts no longer recommend photos, the row ticks (QA2 NEW-4).
  const [recPhotos] = useState(recommendPhotos ?? null);
  const photosDone = recPhotos != null && !recommendPhotos;
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const blocked = missing.length > 0;
  const overridable = missing.every((m) => m.overridable);
  const ready = !blocked || (override && reason.trim().length >= 3);
  const close = () => onOpenChange(false);

  // Camera, signature and payment fixes are full controls: they sit under the
  // label (full width) instead of squeezing it into a one-word column (QA T1-19).
  const wide = (m: GuardMiss) =>
    m.action === "capture_photos" ||
    m.action === "completion_signature" ||
    m.action === "collect_deposit" ||
    m.action === "prepay";
  const fix = (m: GuardMiss): ReactNode => {
    switch (m.action) {
      case "capture_photos":
        return cameraNode ?? null;
      case "completion_signature":
        return signatureNode ?? null;
      case "collect_deposit":
      case "prepay":
        return collectNode ?? null;
      case "request_start_approval":
        return onRequestApproval && !m.label.startsWith("Waiting") ? (
          <Button
            size="sm"
            variant="tinted"
            loading={approvalPending}
            onClick={onRequestApproval}
          >
            Request approval
          </Button>
        ) : null;
      case "sign_estimate":
      case "change_order":
        return (
          <Button
            size="sm"
            variant="tinted"
            href={`/jobs/${jobId}?tab=estimate`}
            onClick={close}
          >
            {m.action === "change_order" ? "Change order" : "Estimate"}
          </Button>
        );
      case "checklist":
      case "ownership_check":
        return (
          <Button
            size="sm"
            variant="tinted"
            href={`/jobs/${jobId}?tab=overview#checklist`}
            onClick={close}
          >
            Checklist
          </Button>
        );
      default:
        return null;
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "start" ? "Start job" : "Complete job"}
      detents={["large"]}
      dirty={override && reason.trim() !== ""}
      leading={
        <Button variant="plain" size="sm" onClick={close}>
          Cancel
        </Button>
      }
      footer={
        <Button
          size="lg"
          fullWidth
          loading={pending}
          disabled={!ready}
          variant={blocked && override ? "destructive" : "filled"}
          onClick={() => onSubmit(blocked && override ? reason.trim() : null)}
        >
          {mode === "start"
            ? blocked && override
              ? "Start anyway"
              : "Start job"
            : blocked && override
              ? "Complete anyway"
              : "Complete job"}
        </Button>
      }
    >
      <div className="flex flex-col gap-5 px-4 pb-6">
        {mode === "complete" && readinessSlot && (
          <div className="flex items-center gap-3 rounded-card bg-card p-4 shadow-card">
            {readinessSlot}
            <p className="text-subhead text-label-2">
              How dispute-proof this job is. Photos, signatures and receipts
              raise it.
            </p>
          </div>
        )}
        {blocked ? (
          <section aria-labelledby="req-h">
            <h2
              id="req-h"
              className="px-4 pb-1.5 text-footnote uppercase text-label-2"
            >
              Before you {mode === "start" ? "start" : "finish"}
            </h2>
            <ul className="list-card">
              {missing.map((m) => {
                const node = fix(m);
                const below = node != null && wide(m);
                return (
                  <li
                    key={`${m.key}-${m.label}`}
                    className="list-row flex min-h-14 flex-col gap-2.5 px-4 py-2.5"
                  >
                    <div className="flex items-center gap-3">
                      <CircleDashed
                        aria-hidden
                        size={22}
                        className="shrink-0 text-warning"
                      />
                      <span className="min-w-0 flex-1 text-body">
                        {m.label}
                      </span>
                      {!below && node != null && (
                        <span className="shrink-0">{node}</span>
                      )}
                    </div>
                    {below && <div className="pl-[34px]">{node}</div>}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <Banner
            tone="success"
            title={
              mode === "complete" && (invoiceEmpty || recPhotos)
                ? "Required items done"
                : "All set"
            }
          >
            {mode === "start"
              ? "Nothing is blocking this job. Tap Start job when you begin work."
              : invoiceEmpty || recPhotos
                ? "Nothing blocks completing. Check the notes below first."
                : "Every requirement is met."}
          </Banner>
        )}
        {mode === "complete" && invoiceEmpty && (
          <Banner
            tone="warning"
            icon={<ReceiptText size={18} aria-hidden />}
            title="No items on the invoice yet"
            action={
              <Button
                size="sm"
                variant="tinted"
                href={`/jobs/${jobId}?tab=invoice`}
                onClick={close}
              >
                Invoice
              </Button>
            }
          >
            Add the work and parts so the customer gets the right bill. With no
            items, the invoice stays a draft and isn't sent.
          </Banner>
        )}
        {mode === "complete" &&
          ((signatureNode &&
            !missing.some((m) => m.action === "completion_signature")) ||
            (recPhotos &&
              cameraNode &&
              !missing.some((m) => m.action === "capture_photos"))) && (
            <section aria-labelledby="rec-h">
              <h2
                id="rec-h"
                className="px-4 pb-1.5 text-footnote uppercase text-label-2"
              >
                Recommended
              </h2>
              <ul className="list-card">
                {recPhotos &&
                  cameraNode &&
                  !missing.some((m) => m.action === "capture_photos") && (
                    <li className="list-row flex min-h-14 flex-col gap-2.5 px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        {photosDone ? (
                          <CircleCheck
                            aria-hidden
                            size={22}
                            className="shrink-0 text-[var(--sys-green)]"
                          />
                        ) : (
                          <CircleDashed
                            aria-hidden
                            size={22}
                            className="shrink-0 text-label-3"
                          />
                        )}
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="text-body">{recPhotos}</span>
                          {photosDone ? (
                            <span className="text-footnote text-[var(--sys-green)]">
                              Added
                            </span>
                          ) : (
                            <span className="text-footnote text-label-2">
                              Not required, but they win disputes.
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="pl-[34px]">{cameraNode}</div>
                    </li>
                  )}
                {signatureNode &&
                  !missing.some((m) => m.action === "completion_signature") && (
                    // Button under the label, like the camera, so the label stays on
                    // one line at 390 px (QA T1-19).
                    <li className="list-row flex min-h-14 flex-col gap-2.5 px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        {signed ? (
                          <CircleCheck
                            aria-hidden
                            size={22}
                            className="shrink-0 text-[var(--sys-green)]"
                          />
                        ) : (
                          <CircleDashed
                            aria-hidden
                            size={22}
                            className="shrink-0 text-label-3"
                          />
                        )}
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="text-body">Customer sign-off</span>
                          {signed && (
                            <span className="text-footnote text-[var(--sys-green)]">
                              Signed
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="pl-[34px]">{signatureNode}</div>
                    </li>
                  )}
              </ul>
            </section>
          )}
        {blocked && canOverride && overridable && (
          <section className="flex flex-col gap-3">
            <ul className="list-card">
              <li>
                <ToggleRow
                  icon={
                    <span
                      className="tint-bg tint-fg flex size-[29px] items-center justify-center rounded-[7px]"
                      style={toneStyle("red")}
                    >
                      <ShieldCheck size={17} aria-hidden />
                    </span>
                  }
                  title="Override requirements"
                  subtitle="Logged with your name and reason"
                  checked={override}
                  onChange={(e) => setOverride(e.target.checked)}
                />
              </li>
            </ul>
            {override && (
              <TextArea
                label="Reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why it's OK to skip these"
                rows={2}
                data-autofocus
              />
            )}
          </section>
        )}
      </div>
    </Sheet>
  );
}
