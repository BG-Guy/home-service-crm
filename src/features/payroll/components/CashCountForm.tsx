"use client";

import { useState } from "react";
import { newId } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import { Button } from "@/ui/components/Button";
import { TextArea } from "@/ui/components/Field";
import { MoneyField } from "@/ui/components/MoneyField";
import { toast } from "@/ui/components/Toast";
import { submitOffline, toastQueued } from "./submit";

/** S44 body: declare what's in the truck; a difference needs a note (cash.discrepancy_declared). */
export function CashCountForm({ systemCents }: { systemCents: number }) {
  const [declared, setDeclared] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<null | "match" | "diff">(null);
  const diff = declared != null && declared !== systemCents;
  if (done)
    return (
      <p className="px-4 py-3 text-subhead text-label-2">
        {done === "match"
          ? "Count confirmed. Thanks!"
          : "Count recorded with your note. The office will follow up."}
      </p>
    );
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <MoneyField
        label="Cash and checks in hand"
        valueCents={declared}
        onChangeCents={setDeclared}
        hint={`System says ${formatMoney(systemCents)}`}
      />
      {diff && (
        <TextArea
          label="What happened?"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          placeholder="e.g. Customer paid $20 less; gave change"
        />
      )}
      <Button
        variant={diff ? "filled" : "tinted"}
        loading={pending}
        disabled={declared == null || (diff && note.trim().length < 3)}
        onClick={async () => {
          setPending(true);
          const r = await submitOffline<{ discrepancy: boolean }>(
            "payroll.declareCash",
            {
              declaredCents: declared ?? 0,
              note: note || null,
              clientId: newId(),
            },
          );
          setPending(false);
          if (!r.ok) {
            toast({ title: "Couldn't save", message: r.error, tone: "error" });
            return;
          }
          if (r.queued) toastQueued("Cash count");
          setDone(diff ? "diff" : "match");
        }}
      >
        {diff ? "Report difference" : "Confirm count"}
      </Button>
    </div>
  );
}
