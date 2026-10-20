"use client";

import { Button } from "@/ui/components/Button";
import {
  DateField,
  TextArea,
  TextField,
  TimeField,
} from "@/ui/components/Field";
import { Sheet } from "@/ui/components/Sheet";

export type Draft = {
  id: string | null;
  inDate: string;
  inTime: string;
  outDate: string;
  outTime: string;
  breakMinutes: number;
  reason: string;
};

/** Add / edit a time entry (time.manage). Loaded on first open by TimeEntryList. */
export default function TimeEntrySheet({
  draft,
  setDraft,
  errors,
  pending,
  onSave,
}: {
  draft: Draft;
  setDraft: (d: Draft | null) => void;
  errors: Record<string, string[]>;
  pending: boolean;
  onSave: () => void;
}) {
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && setDraft(null)}
      title={draft.id ? "Edit time entry" : "Add time entry"}
      detents={["content"]}
      dirty
      leading={
        <Button variant="plain" size="sm" onClick={() => setDraft(null)}>
          Cancel
        </Button>
      }
      footer={
        <Button
          size="lg"
          fullWidth
          loading={pending}
          disabled={draft.reason.trim().length < 3}
          onClick={onSave}
        >
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3 px-4 pb-4">
        <DateField
          label="Clock-in date"
          value={draft.inDate}
          onChange={(ev) => setDraft({ ...draft, inDate: ev.target.value })}
          error={errors.clockIn?.[0]}
        />
        <TimeField
          label="Time"
          value={draft.inTime}
          onChange={(ev) => setDraft({ ...draft, inTime: ev.target.value })}
        />
        <DateField
          label="Clock-out date"
          value={draft.outDate}
          onChange={(ev) => setDraft({ ...draft, outDate: ev.target.value })}
          error={errors.clockOut?.[0]}
        />
        <TimeField
          label="Time"
          value={draft.outTime}
          onChange={(ev) => setDraft({ ...draft, outTime: ev.target.value })}
        />
        <TextField
          label="Break (minutes)"
          type="number"
          inputMode="numeric"
          min={0}
          max={600}
          className="col-span-2"
          value={String(draft.breakMinutes)}
          onChange={(ev) =>
            setDraft({
              ...draft,
              breakMinutes: Math.max(0, Number(ev.target.value) || 0),
            })
          }
        />
        <TextArea
          label="Reason for the change"
          className="col-span-2"
          placeholder="e.g. Forgot to clock out"
          value={draft.reason}
          maxLength={500}
          rows={2}
          error={errors.reason?.[0]}
          onChange={(ev) => setDraft({ ...draft, reason: ev.target.value })}
        />
        <p className="col-span-2 text-footnote text-label-2">
          Times are in the company time zone. Edits are saved to the audit log.
        </p>
      </div>
    </Sheet>
  );
}
