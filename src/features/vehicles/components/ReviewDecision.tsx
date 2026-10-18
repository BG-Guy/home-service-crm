"use client";

import { Check, Sparkles, X } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { DateField, TextArea, TextField } from "@/ui/components/Field";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import {
  approveAllCleanVehicleLogs,
  decideVehicleApproval,
  explainVehicleFlags,
  getVehicleAiResult,
} from "../actions";
import type { ReviewItem } from "../review";

type Editable = ReviewItem["editable"][number];

const EDIT_LABEL: Record<Editable, string> = {
  value: "Odometer (mi)",
  odometer: "Odometer (mi)",
  gallons: "Gallons",
  totalCents: "Total ($)",
  costCents: "Cost ($)",
  expiresOn: "Expires on",
  miles: "Miles",
};

const isMoney = (k: Editable) => k === "totalCents" || k === "costCents";

/** Approve / Reject (reason) / Edit-and-approve for one vehicle review item. */
export function ReviewDecision({
  approvalId,
  editable,
  current,
  hasFlags,
  aiEnabled,
}: {
  approvalId: string;
  editable: Editable[];
  current: Record<string, number | string | null>;
  hasFlags: boolean;
  aiEnabled: boolean;
}) {
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"reject" | "edit" | null>(null);
  const [reason, setReason] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      editable.map((k) => {
        const v = current[k];
        if (v == null) return [k, ""];
        return [k, isMoney(k) ? (Number(v) / 100).toFixed(2) : String(v)];
      }),
    ),
  );
  const [explain, setExplain] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);

  const decide = (decision: "approved" | "rejected", withEdits = false) =>
    start(async () => {
      const parsed: Record<string, number | string | null> = {};
      if (withEdits)
        for (const k of editable) {
          const raw = (edits[k] ?? "").trim();
          if (!raw) continue;
          if (k === "expiresOn") parsed[k] = raw;
          else if (isMoney(k))
            parsed[k] = Math.round(Number(raw.replace(/[^\d.]/g, "")) * 100);
          else parsed[k] = Number(raw.replace(/[^\d.]/g, ""));
        }
      const r = await decideVehicleApproval({
        approvalId,
        decision,
        reason: decision === "rejected" ? reason : null,
        edits: withEdits ? parsed : undefined,
      });
      if (!r.ok) {
        toast({
          title: r.fieldErrors?.reason?.[0] ?? r.error,
          tone: "error",
        });
        return;
      }
      setMode(null);
      toast({
        title: decision === "approved" ? "Approved" : "Rejected",
        message: decision === "rejected" ? "The tech was told why." : undefined,
        tone: decision === "approved" ? "success" : "default",
      });
    });

  const askAi = async () => {
    setExplaining(true);
    try {
      const r = await explainVehicleFlags({ approvalId });
      if (!r.ok || !r.data) {
        toast({ title: r.ok ? "AI unavailable" : r.error, tone: "warning" });
        return;
      }
      for (let i = 0; i < 15; i++) {
        const res = await getVehicleAiResult(r.data.aiTaskId);
        if (res.status === "done" && res.text) {
          setExplain(res.text);
          return;
        }
        if (res.status === "failed" || res.status.startsWith("skipped")) {
          toast({ title: "AI couldn't explain this one", tone: "warning" });
          return;
        }
        await new Promise((ok) => setTimeout(ok, 2000));
      }
      toast({ title: "Still thinking — try again shortly", tone: "default" });
    } finally {
      setExplaining(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {explain && (
        <div className="rounded-card bg-fill-2 p-3 text-subhead">
          <p className="mb-1 flex items-center gap-1.5 text-footnote font-semibold text-label-2">
            <Sparkles aria-hidden size={14} /> AI explanation (suggestion only)
          </p>
          {explain}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          icon={<Check size={16} aria-hidden />}
          loading={pending && mode === null}
          onClick={() => decide("approved")}
        >
          Approve
        </Button>
        {editable.length > 0 && (
          <Button size="sm" variant="gray" onClick={() => setMode("edit")}>
            Edit & approve
          </Button>
        )}
        <Button
          size="sm"
          variant="gray"
          icon={<X size={16} aria-hidden />}
          onClick={() => setMode("reject")}
        >
          <span className="text-danger">Reject</span>
        </Button>
        {hasFlags && aiEnabled && (
          <Button
            size="sm"
            variant="plain"
            icon={<Sparkles size={15} aria-hidden />}
            loading={explaining}
            onClick={askAi}
          >
            Explain flags
          </Button>
        )}
      </div>
      <Sheet
        open={mode !== null}
        onOpenChange={(o) => !o && setMode(null)}
        title={mode === "edit" ? "Edit and approve" : "Reject entry"}
        detents={["medium", "large"]}
        leading={
          <Button variant="plain" size="sm" onClick={() => setMode(null)}>
            Cancel
          </Button>
        }
        footer={
          mode === "edit" ? (
            <Button
              size="lg"
              fullWidth
              loading={pending}
              onClick={() => decide("approved", true)}
            >
              Save and approve
            </Button>
          ) : (
            <Button
              size="lg"
              variant="destructive"
              fullWidth
              loading={pending}
              disabled={!reason.trim()}
              onClick={() => decide("rejected")}
            >
              Reject
            </Button>
          )
        }
      >
        <div className="flex flex-col gap-4 pb-4 pt-1">
          {mode === "edit" ? (
            editable.map((k) =>
              k === "expiresOn" ? (
                <DateField
                  key={k}
                  label={EDIT_LABEL[k]}
                  value={edits[k] ?? ""}
                  onChange={(e) =>
                    setEdits({ ...edits, [k]: e.currentTarget.value })
                  }
                />
              ) : (
                <TextField
                  key={k}
                  label={EDIT_LABEL[k]}
                  inputMode="decimal"
                  value={edits[k] ?? ""}
                  onChange={(e) =>
                    setEdits({ ...edits, [k]: e.currentTarget.value })
                  }
                />
              ),
            )
          ) : (
            <TextArea
              label="Reason (sent to the tech)"
              placeholder="The photo is blurry — please retake it."
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
              rows={3}
            />
          )}
        </div>
      </Sheet>
    </div>
  );
}

/** Bulk "Approve all clean" (entries with no flags and no missing evidence). */
export function ApproveAllCleanButton({ ids }: { ids: string[] }) {
  const [pending, start] = useTransition();
  if (ids.length === 0) return null;
  return (
    <Button
      size="sm"
      variant="tinted"
      loading={pending}
      icon={<Check size={16} aria-hidden />}
      onClick={() =>
        start(async () => {
          const r = await approveAllCleanVehicleLogs({ approvalIds: ids });
          if (!r.ok) toast({ title: r.error, tone: "error" });
          else
            toast({
              title: `Approved ${r.data?.approved ?? 0}`,
              message: r.data?.skipped
                ? `${r.data.skipped} changed since loading and need a look.`
                : undefined,
              tone: "success",
            });
        })
      }
    >
      Approve all clean ({ids.length})
    </Button>
  );
}
