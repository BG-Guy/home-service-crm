"use client";

import { ChevronDown } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DatePickerButton } from "@/ui/components/DatePicker";

// The schedule's date line ("Sunday, Oct 18 ▾") opens the calendar window to jump
// to any day. The board slides toward the picked day (`cal-next` / `cal-prev`,
// the same transition as the ‹ › arrows).

const PRESETS = [
  { label: "Today", days: 0 },
  { label: "Tomorrow", days: 1 },
  { label: "Next week", days: 7 },
] as const;

export function ScheduleDateJump({
  date,
  label,
  todayKey,
}: {
  /** The board's anchor day ('YYYY-MM-DD'). */
  date: string;
  /** What the board shows, e.g. "Sunday, Oct 18" or "Oct 18 – Oct 24". */
  label: string;
  /** Today in the company time zone (no `date` param means today). */
  todayKey: string;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "/schedule";
  const params = useSearchParams();
  return (
    <DatePickerButton
      value={date}
      label={`${label}. Choose a day`}
      title="Go to a day"
      presets={PRESETS}
      onSelect={(key) => {
        if (key === date) return;
        const q = new URLSearchParams(params?.toString() ?? "");
        if (key === todayKey) q.delete("date");
        else q.set("date", key);
        const qs = q.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, {
          scroll: false,
          transitionTypes: [key > date ? "cal-next" : "cal-prev"],
        });
      }}
      className="pressable -mx-1.5 inline-flex max-w-full items-center gap-1 rounded-[8px] px-1.5 text-subhead text-label-2 outline-offset-0 hover:bg-fill-2 hover:text-label"
    >
      <span className="truncate">{label}</span>
      <ChevronDown
        aria-hidden
        size={15}
        strokeWidth={2.4}
        className="shrink-0 text-accent-text"
      />
    </DatePickerButton>
  );
}
