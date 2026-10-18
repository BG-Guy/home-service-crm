"use client";

import { Banknote, Camera, Check, Flag } from "lucide-react";
import { useState, useTransition } from "react";
import { newId } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import { Button } from "@/ui/components/Button";
import { CameraButton } from "@/ui/components/CameraButton";
import { TextArea, TextField } from "@/ui/components/Field";
import { MoneyField } from "@/ui/components/MoneyField";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import {
  acknowledgeStatement,
  confirmRemittance,
  flagStatementLine,
} from "../actions";
import { fe, submitOffline, toastQueued } from "./submit";

/** Cash hand-in / bank deposit with a slip photo (cash.remit_own). Offline-capable. */
export function RemitCashButton({
  heldCents,
  maxCents = heldCents,
  label = "Hand in cash",
  variant = "filled",
}: {
  heldCents: number;
  /** Most that can be handed in now: held minus hand-ins still waiting (QA T1-06). */
  maxCents?: number;
  label?: string;
  variant?: "filled" | "tinted" | "gray";
}) {
  const max = Math.max(0, Math.min(heldCents, maxCents));
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState(newId);
  const [amount, setAmount] = useState<number | null>(max > 0 ? max : null);
  const tooMuch = amount != null && amount > max;
  const [method, setMethod] = useState<"hand_in" | "bank_deposit">("hand_in");
  const [proof, setProof] = useState<{
    clientId: string;
    mediaId?: string;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();

  const submit = async () => {
    setPending(true);
    const r = await submitOffline("payroll.remitCash", {
      amountCents: amount ?? 0,
      method,
      proofMediaId: proof?.mediaId ?? null,
      proofClientId: proof?.clientId ?? null,
      clientId,
    });
    setPending(false);
    if (!r.ok) {
      setErrors(r.fieldErrors ?? { amountCents: [r.error] });
      return;
    }
    if (r.queued) toastQueued("Hand-in");
    else
      toast({
        title: "Hand-in recorded",
        message: "The office confirms it when they receive it.",
        tone: "success",
      });
    setOpen(false);
    setClientId(newId());
    setProof(null);
    setErrors(undefined);
  };

  return (
    <>
      <Button
        variant={variant}
        size="md"
        icon={<Banknote size={18} aria-hidden />}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Hand in cash"
        detents={["content"]}
        leading={
          <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        }
        footer={
          <Button
            size="lg"
            fullWidth
            loading={pending}
            disabled={
              !amount || tooMuch || (method === "bank_deposit" && !proof)
            }
            onClick={submit}
          >
            Record {amount ? formatMoney(amount) : "hand-in"}
          </Button>
        }
      >
        <div className="flex flex-col gap-4 pb-6 pt-1">
          <p className="text-subhead text-label-2">
            You&apos;re holding {formatMoney(heldCents)} in cash and checks.
            Checks are payable to the company and always handed in.
          </p>
          <SegmentedControl
            label="How"
            value={method}
            onChange={setMethod}
            segments={[
              { value: "hand_in", label: "Hand to office" },
              { value: "bank_deposit", label: "Bank deposit" },
            ]}
          />
          <MoneyField
            label="Amount"
            valueCents={amount}
            onChangeCents={setAmount}
            error={
              tooMuch
                ? max > 0
                  ? `You can hand in up to ${formatMoney(max)}.`
                  : "Your earlier hand-ins already cover what you hold."
                : fe(errors, "amountCents")
            }
          />
          <CameraButton
            kind="receipt"
            tag="receipt"
            label={
              proof
                ? "Retake photo"
                : method === "bank_deposit"
                  ? "Photo of deposit slip"
                  : "Photo (optional)"
            }
            multiple={false}
            icon={
              proof?.mediaId ? (
                <Check size={18} aria-hidden />
              ) : (
                <Camera size={18} aria-hidden />
              )
            }
            onQueued={(r) =>
              setProof({ clientId: r.clientId, mediaId: r.mediaId })
            }
            onUploaded={(r) =>
              setProof({ clientId: r.clientId, mediaId: r.mediaId })
            }
            onError={(e) =>
              toast({
                title: "Photo failed",
                message: e.message,
                tone: "error",
              })
            }
          />
          {fe(errors, "proofMediaId") && (
            <p role="alert" className="text-footnote text-danger">
              {fe(errors, "proofMediaId")}
            </p>
          )}
        </div>
      </Sheet>
    </>
  );
}

/** Office: confirm (or dispute) a pending hand-in (cash.receive). */
export function ConfirmRemittanceButtons({
  remittanceId,
}: {
  remittanceId: string;
}) {
  const [pending, start] = useTransition();
  const go = (decision: "confirmed" | "disputed") =>
    start(async () => {
      const r = await confirmRemittance({ remittanceId, decision });
      toast(
        r.ok
          ? {
              title:
                decision === "confirmed"
                  ? "Cash received"
                  : "Marked as disputed",
              tone: decision === "confirmed" ? "success" : "warning",
            }
          : { title: "Couldn't save", message: r.error, tone: "error" },
      );
    });
  return (
    <span className="flex gap-1">
      <Button size="sm" loading={pending} onClick={() => go("confirmed")}>
        Received
      </Button>
      <Button
        size="sm"
        variant="plain"
        className="text-danger"
        disabled={pending}
        onClick={() => go("disputed")}
      >
        Dispute
      </Button>
    </span>
  );
}

/** Tech e-acknowledgment of a statement: typed name (+ timestamp + IP server-side). */
export function AcknowledgeStatement({
  settlementId,
  defaultName,
}: {
  settlementId: string;
  defaultName: string;
}) {
  const [name, setName] = useState(defaultName);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await acknowledgeStatement({
            settlementId,
            typedName: name,
          });
          if (!r.ok) {
            setError(r.fieldErrors?.typedName?.[0] ?? r.error);
            return;
          }
          toast({ title: "Statement acknowledged", tone: "success" });
        });
      }}
    >
      <TextField
        label="Type your full name to acknowledge"
        autoComplete="name"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        error={error}
      />
      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={pending}
        disabled={name.trim().length < 2}
      >
        I&apos;ve reviewed this statement
      </Button>
      <p className="text-footnote text-label-2">
        Acknowledging records your name, the time and your IP address. It
        doesn&apos;t waive your right to flag a line.
      </p>
    </form>
  );
}

/** Flag a statement line (or the whole statement) during the tech review window. */
export function FlagLineButton({
  settlementId,
  ledgerEntryId,
  what,
}: {
  settlementId: string;
  ledgerEntryId?: string | null;
  what: string;
}) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        size="sm"
        variant="plain"
        className="print:hidden"
        icon={<Flag size={15} aria-hidden />}
        onClick={() => setOpen(true)}
        aria-label={`Flag ${what}`}
      >
        Flag
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Flag a line"
        detents={["content"]}
        footer={
          <Button
            size="lg"
            fullWidth
            loading={pending}
            disabled={comment.trim().length < 3}
            onClick={() =>
              start(async () => {
                const r = await flagStatementLine({
                  settlementId,
                  ledgerEntryId: ledgerEntryId ?? null,
                  comment,
                });
                if (!r.ok) {
                  setError(r.fieldErrors?.comment?.[0] ?? r.error);
                  return;
                }
                toast({
                  title: "Flag sent",
                  message:
                    "Your admin reviews it before approving the statement.",
                  tone: "success",
                });
                setOpen(false);
                setComment("");
              })
            }
          >
            Send flag
          </Button>
        }
      >
        <div className="flex flex-col gap-3 pb-6 pt-1">
          <p className="text-subhead text-label-2">{what}</p>
          <TextArea
            label="What looks wrong?"
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.currentTarget.value)}
            error={error}
            autoFocus
          />
        </div>
      </Sheet>
    </>
  );
}
