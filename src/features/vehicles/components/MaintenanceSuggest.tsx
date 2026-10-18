"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";
import { getVehicleAiResult, requestMaintenanceSuggestion } from "../actions";

/**
 * Gemini maintenance suggestions from the VIN-decoded data + mileage. Always shown as
 * "Suggested — admin confirms"; nothing is created automatically.
 */
export function MaintenanceSuggest({
  vehicleId,
  initial,
}: {
  vehicleId: string;
  initial: { text: string | null; status: string; at: string } | null;
}) {
  const [text, setText] = useState(initial?.text ?? null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await requestMaintenanceSuggestion({ vehicleId });
      if (!r.ok || !r.data) {
        toast({ title: r.ok ? "AI unavailable" : r.error, tone: "warning" });
        return;
      }
      for (let i = 0; i < 20; i++) {
        const res = await getVehicleAiResult(r.data.aiTaskId);
        if (res.status === "done" && res.text) {
          setText(res.text);
          return;
        }
        if (res.status === "failed" || res.status.startsWith("skipped")) {
          toast({
            title: "No suggestion this time",
            message: res.error ?? "The AI budget may be used up for today.",
            tone: "warning",
          });
          return;
        }
        await new Promise((ok) => setTimeout(ok, 2000));
      }
      toast({ title: "Still working — check back in a minute" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 p-4">
      {text ? (
        <>
          <p className="flex items-center gap-1.5 text-footnote font-semibold text-label-2">
            <Sparkles aria-hidden size={14} /> Suggested — admin confirms
          </p>
          <p className="whitespace-pre-line text-subhead">{text}</p>
        </>
      ) : (
        <p className="text-subhead text-label-2">
          Get maintenance suggestions from the decoded VIN, mileage and service
          history. Nothing is scheduled until you add a reminder.
        </p>
      )}
      <div>
        <Button
          size="sm"
          variant="tinted"
          loading={busy}
          icon={<Sparkles size={15} aria-hidden />}
          onClick={run}
        >
          {text ? "Refresh suggestions" : "Suggest maintenance"}
        </Button>
      </div>
    </div>
  );
}
