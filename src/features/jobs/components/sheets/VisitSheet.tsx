"use client";

import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { DateField, Select, TimeField } from "@/ui/components/Field";
import { Sheet } from "@/ui/components/Sheet";

/** Pick a date + arrival window (return visit; also used by reschedule). */
export default function VisitSheet({
  open,
  onOpenChange,
  title,
  submitLabel,
  defaultDate,
  defaultStart = "09:00",
  defaultMinutes,
  windowLengths,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  submitLabel: string;
  defaultDate: string;
  defaultStart?: string;
  defaultMinutes: number;
  windowLengths: number[];
  pending: boolean;
  onSubmit: (v: { date: string; start: string; minutes: number }) => void;
}) {
  const [date, setDate] = useState(defaultDate);
  const [start, setStart] = useState(defaultStart);
  const [minutes, setMinutes] = useState(defaultMinutes);
  const fmt = (m: number) =>
    m % 60 === 0 ? `${m / 60} h window` : `${m} min window`;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      detents={["content"]}
      leading={
        <Button variant="plain" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      }
      footer={
        <Button
          size="lg"
          fullWidth
          loading={pending}
          disabled={!date || !start}
          onClick={() => onSubmit({ date, start, minutes })}
        >
          {submitLabel}
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3 px-4 pb-4">
        <DateField
          label="Date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
        <TimeField
          label="Arrive from"
          value={start}
          step={900}
          onChange={(e) => setStart(e.target.value)}
          required
        />
        <Select
          label="Window"
          className="col-span-2"
          value={String(minutes)}
          onChange={(e) => setMinutes(Number(e.target.value))}
          options={windowLengths.map((m) => ({
            value: String(m),
            label: fmt(m),
          }))}
        />
      </div>
    </Sheet>
  );
}
