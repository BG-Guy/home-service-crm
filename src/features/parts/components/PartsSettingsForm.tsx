"use client";

import { useState, useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { Select, TextField } from "@/ui/components/Field";
import { ListSection } from "@/ui/components/List";
import { MoneyField } from "@/ui/components/MoneyField";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import { savePartsSettings } from "../actions";

export interface PartsSettingsValues {
  receiptRequiredOverCents: number;
  autoApproveUnderCents: number;
  aiMatchToleranceCents: number;
  receiptMaxAgeDays: number;
  staleReceiptDays: number;
  warrantyClaimDays: number;
  cycleCountDay: number;
  decrementOnUse: boolean;
  restockAssigneeUserId: string | null;
}

type DayKey =
  | "receiptMaxAgeDays"
  | "staleReceiptDays"
  | "warrantyClaimDays"
  | "cycleCountDay";

/** [min, max, message]: the same ranges the server enforces. */
const DAY_RULES: Record<DayKey, [number, number, string]> = {
  receiptMaxAgeDays: [0, 365, "Enter a whole number of days from 0 to 365."],
  staleReceiptDays: [1, 3650, "Enter a whole number of days from 1 to 3650."],
  warrantyClaimDays: [1, 365, "Enter a whole number of days from 1 to 365."],
  cycleCountDay: [1, 28, "Pick a day of the month from 1 to 28."],
};

export function PartsSettingsForm({
  initial,
  people,
  inventoryOn,
  aiOn,
}: {
  initial: PartsSettingsValues;
  people: { id: string; name: string }[];
  inventoryOn: boolean;
  aiOn: boolean;
}) {
  const [v, setV] = useState(initial);
  // Day fields keep what was typed; they are validated on save, never coerced to 0
  // on the way (QA T3-10).
  const [days, setDays] = useState<Record<DayKey, string>>(() => ({
    receiptMaxAgeDays: String(initial.receiptMaxAgeDays),
    staleReceiptDays: String(initial.staleReceiptDays),
    warrantyClaimDays: String(initial.warrantyClaimDays),
    cycleCountDay: String(initial.cycleCountDay),
  }));
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [pending, start] = useTransition();
  const set = <K extends keyof PartsSettingsValues>(
    k: K,
    val: PartsSettingsValues[K],
  ) => setV((x) => ({ ...x, [k]: val }));
  const setDay = (k: DayKey, val: string) => {
    setDays((x) => ({ ...x, [k]: val }));
    setErrors((x) => (x?.[k] ? { ...x, [k]: [] } : x));
  };
  const e = (k: string) => errors?.[k]?.[0] ?? null;
  return (
    <form
      className="flex flex-col gap-[var(--section-gap)]"
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault();
        const parsed = {} as Record<DayKey, number>;
        const bad: Record<string, string[]> = {};
        for (const k of Object.keys(DAY_RULES) as DayKey[]) {
          const [min, max, msg] = DAY_RULES[k];
          const raw = days[k].trim();
          const n = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
          if (!Number.isInteger(n) || n < min || n > max) bad[k] = [msg];
          else parsed[k] = n;
        }
        if (Object.keys(bad).length) {
          setErrors(bad);
          toast({
            title: "Not saved",
            message: "Fix the highlighted fields.",
            tone: "error",
          });
          return;
        }
        start(async () => {
          const r = await savePartsSettings({
            ...v,
            ...parsed,
            decrementOnUse: v.decrementOnUse,
            restockAssigneeUserId: v.restockAssigneeUserId || null,
          });
          if (!r.ok) {
            setErrors(r.fieldErrors);
            toast({ title: "Not saved", message: r.error, tone: "error" });
            return;
          }
          setErrors(undefined);
          toast({ title: "Parts settings saved", tone: "success" });
        });
      }}
    >
      <ListSection
        header="Tech-paid receipts"
        footer="A receipt is auto-approved when it's under the limit, has a photo, the date is near the job and (with AI on) the photo total matches the typed total."
      >
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <MoneyField
            label="Receipt photo required over"
            valueCents={v.receiptRequiredOverCents}
            onChangeCents={(c) => set("receiptRequiredOverCents", c ?? 0)}
            error={e("receiptRequiredOverCents")}
            hint="$0 = always required"
          />
          <MoneyField
            label="Auto-approve under"
            valueCents={v.autoApproveUnderCents}
            onChangeCents={(c) => set("autoApproveUnderCents", c ?? 0)}
            error={e("autoApproveUnderCents")}
          />
          <MoneyField
            label="Photo total may differ by"
            valueCents={v.aiMatchToleranceCents}
            onChangeCents={(c) => set("aiMatchToleranceCents", c ?? 0)}
            error={e("aiMatchToleranceCents")}
            hint={
              aiOn
                ? "AI reads the receipt total"
                : "AI is off: this applies once AI is enabled"
            }
          />
          <TextField
            label="Purchase date within (days of the job)"
            inputMode="numeric"
            value={days.receiptMaxAgeDays}
            onChange={(ev) =>
              setDay("receiptMaxAgeDays", ev.currentTarget.value)
            }
            error={e("receiptMaxAgeDays")}
          />
          <TextField
            label="Flag receipts waiting over (days) ⚖️"
            inputMode="numeric"
            value={days.staleReceiptDays}
            onChange={(ev) =>
              setDay("staleReceiptDays", ev.currentTarget.value)
            }
            error={e("staleReceiptDays")}
            hint="Accountable plans need prompt substantiation (60 days is the IRS safe harbor)"
          />
          <TextField
            label="Warranty claim due in (days)"
            inputMode="numeric"
            value={days.warrantyClaimDays}
            onChange={(ev) =>
              setDay("warrantyClaimDays", ev.currentTarget.value)
            }
            error={e("warrantyClaimDays")}
            hint="Task created when a callback is caused by a part"
          />
        </div>
      </ListSection>
      <ListSection
        header="Inventory"
        footer={
          inventoryOn
            ? undefined
            : "Inventory is off. Turn it on in Settings → Features."
        }
      >
        <ToggleRow
          title="Take parts off the truck when added to a job"
          checked={v.decrementOnUse}
          onChange={(ev) => set("decrementOnUse", ev.currentTarget.checked)}
        />
        <div className="flex flex-col gap-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Monthly count on day"
              inputMode="numeric"
              value={days.cycleCountDay}
              onChange={(ev) => setDay("cycleCountDay", ev.currentTarget.value)}
              error={e("cycleCountDay")}
            />
            <Select
              label="Restock requests go to"
              value={v.restockAssigneeUserId ?? ""}
              onChange={(ev) =>
                set("restockAssigneeUserId", ev.currentTarget.value || null)
              }
              options={[
                { value: "", label: "Office queue" },
                ...people.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </div>
        </div>
      </ListSection>
      <Button type="submit" loading={pending} className="mx-4 self-start">
        Save
      </Button>
    </form>
  );
}
