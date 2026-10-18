"use client";

import { Check, PencilLine, X } from "lucide-react";
import { useState, useTransition } from "react";
import { parseMoneyToCents } from "@/lib/money";
import { Button } from "@/ui/components/Button";
import { DateField } from "@/ui/components/DatePicker";
import { TextArea, TextField } from "@/ui/components/Field";
import { MoneyField } from "@/ui/components/MoneyField";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { approveAllClean, decide } from "../actions";
import type { ApprovalEditField } from "../contracts";

/** Approve · Reject (with a reason) · Edit & approve, for one approvals row. */
export function DecisionBar({
  approvalId,
  title,
  editFields,
}: {
  approvalId: string;
  title: string;
  editFields: ApprovalEditField[];
}) {
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"reject" | "edit" | null>(null);
  const [reason, setReason] = useState("");
  const [values, setValues] = useState<Record<string, string | number | null>>(
    () => Object.fromEntries(editFields.map((f) => [f.key, f.value])),
  );
  const [error, setError] = useState<string | null>(null);

  const send = (decision: "approved" | "rejected", withEdits = false) =>
    start(async () => {
      setError(null);
      const edits: Record<string, unknown> = {};
      if (withEdits)
        for (const f of editFields) {
          const v = values[f.key];
          if (v === null || v === "" || v === undefined) continue;
          edits[f.key] =
            f.type === "money"
              ? typeof v === "number"
                ? v
                : parseMoneyToCents(String(v))
              : f.type === "number"
                ? Number(v)
                : v;
        }
      const r = await decide({
        approvalId,
        decision,
        reason:
          decision === "rejected"
            ? reason
            : withEdits
              ? "Corrected and approved"
              : null,
        edits: withEdits ? edits : undefined,
      });
      if (!r.ok) {
        setError(r.fieldErrors?.reason?.[0] ?? r.error);
        if (!mode)
          toast({ title: "Couldn't save", message: r.error, tone: "error" });
        return;
      }
      setMode(null);
      toast({
        title: decision === "approved" ? "Approved" : "Rejected",
        message: title,
        tone: decision === "approved" ? "success" : "default",
      });
    });

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          size="md"
          icon={<Check size={18} aria-hidden />}
          loading={pending && mode === null}
          disabled={pending}
          onClick={() => send("approved")}
          aria-label={`Approve: ${title}`}
        >
          Approve
        </Button>
        {editFields.length > 0 && (
          <Button
            size="md"
            variant="gray"
            icon={<PencilLine size={18} aria-hidden />}
            disabled={pending}
            onClick={() => setMode("edit")}
          >
            Edit & approve
          </Button>
        )}
        <Button
          size="md"
          variant="plain"
          className="text-danger"
          icon={<X size={18} aria-hidden />}
          disabled={pending}
          onClick={() => setMode("reject")}
          aria-label={`Reject: ${title}`}
        >
          Reject
        </Button>
      </div>

      <Sheet
        open={mode === "reject"}
        onOpenChange={(o) => !o && setMode(null)}
        title="Reject"
        detents={["content"]}
        leading={
          <Button variant="plain" size="sm" onClick={() => setMode(null)}>
            Cancel
          </Button>
        }
        footer={
          <Button
            variant="destructive"
            size="lg"
            fullWidth
            loading={pending}
            disabled={reason.trim().length < 3}
            onClick={() => send("rejected")}
          >
            Reject
          </Button>
        }
      >
        <div className="flex flex-col gap-3 pb-4 pt-1">
          <p className="text-subhead text-label-2">{title}</p>
          <TextArea
            label="Reason"
            placeholder="e.g. Receipt is for a different job"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            error={error}
            rows={3}
            autoFocus
          />
        </div>
      </Sheet>

      <Sheet
        open={mode === "edit"}
        onOpenChange={(o) => !o && setMode(null)}
        title="Edit & approve"
        detents={["content"]}
        leading={
          <Button variant="plain" size="sm" onClick={() => setMode(null)}>
            Cancel
          </Button>
        }
        footer={
          <Button
            size="lg"
            fullWidth
            loading={pending}
            onClick={() => send("approved", true)}
          >
            Save & approve
          </Button>
        }
      >
        <div className="flex flex-col gap-3 pb-4 pt-1">
          <p className="text-subhead text-label-2">{title}</p>
          {editFields.map((f) =>
            f.type === "money" ? (
              <MoneyField
                key={f.key}
                label={f.label}
                allowNegative={f.key.toLowerCase().includes("adjust")}
                valueCents={
                  typeof values[f.key] === "number"
                    ? (values[f.key] as number)
                    : null
                }
                onChangeCents={(c) => setValues((v) => ({ ...v, [f.key]: c }))}
              />
            ) : f.type === "date" ? (
              <DateField
                key={f.key}
                label={f.label}
                value={String(values[f.key] ?? "")}
                onChange={(e) => {
                  const val = e.currentTarget.value;
                  setValues((v) => ({ ...v, [f.key]: val }));
                }}
              />
            ) : (
              <TextField
                key={f.key}
                label={f.label}
                inputMode={f.type === "number" ? "decimal" : undefined}
                value={String(values[f.key] ?? "")}
                onChange={(e) => {
                  const val = e.currentTarget.value;
                  setValues((v) => ({ ...v, [f.key]: val }));
                }}
              />
            ),
          )}
          {error && (
            <p role="alert" className="text-footnote text-danger">
              {error}
            </p>
          )}
        </div>
      </Sheet>
    </>
  );
}

/** Header button: approve every clean item in the current filter. */
export function ApproveAllCleanButton({
  count,
  entityType,
}: {
  count: number;
  entityType?: string;
}) {
  const [pending, start] = useTransition();
  if (count === 0) return null;
  return (
    <Button
      size="sm"
      variant="tinted"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await approveAllClean({ entityType });
          if (!r.ok) {
            toast({
              title: "Couldn't approve",
              message: r.error,
              tone: "error",
            });
            return;
          }
          toast({
            title: `Approved ${r.data?.approved ?? 0} clean item${r.data?.approved === 1 ? "" : "s"}`,
            tone: "success",
          });
        })
      }
    >
      Approve {count} clean
    </Button>
  );
}
