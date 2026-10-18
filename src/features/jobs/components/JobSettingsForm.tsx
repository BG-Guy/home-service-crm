"use client";

import { useState, useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { Select, TextField } from "@/ui/components/Field";
import { ListSection } from "@/ui/components/List";
import { MoneyField } from "@/ui/components/MoneyField";
import { TimeField } from "@/ui/components/TimePicker";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import { cx } from "@/ui/cx";
import { haptic } from "@/ui/motion/haptics";
import { saveJobSettings } from "../actions";

export interface JobSettingsValues {
  arrival_radius_m: number;
  window_lengths_min: number[];
  default_window_min: number;
  unconfirmed_flag_time: string;
  late_cancel_hours: number;
  late_cancel_fee_cents: number;
  no_show_fee_cents: number;
  service_call_fee_cents: number | null;
  service_call_fee_credited: boolean;
  callback_no_charge: boolean;
  warranty_claim_due_days: number;
  board_start_hour: number;
  board_end_hour: number;
  job_prefix: string;
}

const WINDOW_CHOICES = [30, 60, 90, 120, 180, 240, 360];
const fmt = (m: number) => (m % 60 === 0 ? `${m / 60} h` : `${m} min`);
const hourLabel = (h: number) =>
  h === 0 || h === 24
    ? "12 AM"
    : h < 12
      ? `${h} AM`
      : h === 12
        ? "12 PM"
        : `${h - 12} PM`;

/** /settings/jobs form (BUILD_PLAN §3.4 `jobs` namespace + the job number prefix). */
type NumKey =
  | "arrival_radius_m"
  | "late_cancel_hours"
  | "warranty_claim_due_days";
// Number fields keep what's typed (a string draft) and are checked on save, so
// typing never snaps the value to the minimum mid-keystroke (QA T3-11).
const NUM_RULES: Record<NumKey, { min: number; max: number; label: string }> = {
  arrival_radius_m: { min: 50, max: 5000, label: "The arrival radius" },
  late_cancel_hours: { min: 0, max: 168, label: "The late window" },
  warranty_claim_due_days: { min: 1, max: 365, label: "The claim window" },
};

export function JobSettingsForm({ initial }: { initial: JobSettingsValues }) {
  const [v, setV] = useState(initial);
  const [nums, setNums] = useState<Record<NumKey, string>>(() => ({
    arrival_radius_m: String(initial.arrival_radius_m),
    late_cancel_hours: String(initial.late_cancel_hours),
    warranty_claim_due_days: String(initial.warranty_claim_due_days),
  }));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const dirty =
    JSON.stringify(v) !== JSON.stringify(initial) ||
    (Object.keys(nums) as NumKey[]).some((k) => nums[k] !== String(initial[k]));
  const set = <K extends keyof JobSettingsValues>(
    k: K,
    val: JobSettingsValues[K],
  ) => setV((s) => ({ ...s, [k]: val }));
  const setNum = (k: NumKey, raw: string) => {
    setNums((s) => ({ ...s, [k]: raw }));
    if (errors[k]) setErrors(({ [k]: _drop, ...rest }) => rest);
  };
  const err = (k: string) => errors[k]?.[0];

  const toggleWindow = (m: number) => {
    const has = v.window_lengths_min.includes(m);
    const next = has
      ? v.window_lengths_min.filter((x) => x !== m)
      : [...v.window_lengths_min, m].sort((a, b) => a - b);
    if (next.length === 0) return;
    setV((s) => ({
      ...s,
      window_lengths_min: next,
      default_window_min: next.includes(s.default_window_min)
        ? s.default_window_min
        : (next[0] ?? 60),
    }));
  };

  const save = () => {
    const bad: Record<string, string[]> = {};
    const parsed = { ...v };
    for (const k of Object.keys(NUM_RULES) as NumKey[]) {
      const { min, max, label } = NUM_RULES[k];
      const raw = nums[k].trim();
      const n = Number(raw);
      if (!/^\d+$/.test(raw) || n < min || n > max)
        bad[k] = [`${label} must be a whole number from ${min} to ${max}.`];
      else parsed[k] = n;
    }
    if (Object.keys(bad).length) {
      setErrors(bad);
      toast.error("Check the highlighted fields.");
      return;
    }
    start(async () => {
      const r = await saveJobSettings(parsed);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
        return;
      }
      haptic();
      setErrors({});
      setV(parsed);
      toast.success("Job settings saved");
    });
  };

  return (
    <div className="flex flex-col gap-[var(--section-gap)] pb-24">
      <ListSection
        header="Arrival windows"
        footer="The windows offered when booking and dispatching."
      >
        <fieldset className="flex flex-wrap gap-2 px-4 py-3">
          <legend className="sr-only">Window lengths</legend>
          {WINDOW_CHOICES.map((m) => {
            const on = v.window_lengths_min.includes(m);
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                onClick={() => toggleWindow(m)}
                className={cx(
                  "min-h-9 rounded-full px-3.5 text-subhead transition-colors duration-200",
                  on ? "bg-accent text-on-accent" : "bg-fill text-label",
                )}
              >
                {fmt(m)}
              </button>
            );
          })}
        </fieldset>
        <div className="grid grid-cols-2 gap-3 px-4 pb-3">
          <Select
            label="Default window"
            value={String(v.default_window_min)}
            options={v.window_lengths_min.map((m) => ({
              value: String(m),
              label: fmt(m),
            }))}
            onChange={(e) => set("default_window_min", Number(e.target.value))}
          />
          <TimeField
            label="Flag unconfirmed at"
            hint="Day before the visit"
            value={v.unconfirmed_flag_time}
            onChange={(e) => set("unconfirmed_flag_time", e.target.value)}
            error={err("unconfirmed_flag_time")}
          />
        </div>
      </ListSection>

      <ListSection
        header="Arrival check"
        footer="Arrivals farther than this from the property are flagged (never blocked)."
      >
        <div className="px-4 py-3">
          <TextField
            label="Arrival radius (meters)"
            type="number"
            inputMode="numeric"
            min={50}
            max={5000}
            value={nums.arrival_radius_m}
            error={err("arrival_radius_m")}
            onChange={(e) => setNum("arrival_radius_m", e.target.value)}
          />
        </div>
      </ListSection>

      <ListSection
        header="Cancellation policy"
        footer="Fees are added to the job's invoice automatically. Policy text is snapshotted on each job at booking."
      >
        <div className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-3">
          <TextField
            label="Late if within (hours)"
            type="number"
            inputMode="numeric"
            min={0}
            max={168}
            value={nums.late_cancel_hours}
            error={err("late_cancel_hours")}
            onChange={(e) => setNum("late_cancel_hours", e.target.value)}
          />
          <MoneyField
            label="Late cancellation fee"
            valueCents={v.late_cancel_fee_cents}
            onChangeCents={(c) => set("late_cancel_fee_cents", c ?? 0)}
          />
          <MoneyField
            label="No-show fee"
            valueCents={v.no_show_fee_cents}
            onChangeCents={(c) => set("no_show_fee_cents", c ?? 0)}
          />
        </div>
      </ListSection>

      <ListSection
        header="Service-call fee"
        footer="Disclosed to the customer when the job is booked."
      >
        <div className="px-4 py-3">
          <MoneyField
            label="Service-call fee"
            hint="Leave empty for none"
            valueCents={v.service_call_fee_cents}
            onChangeCents={(c) =>
              set("service_call_fee_cents", c && c > 0 ? c : null)
            }
          />
        </div>
        <ToggleRow
          title="Credited toward the repair"
          subtitle="When the customer approves the work"
          checked={v.service_call_fee_credited}
          onChange={(e) => set("service_call_fee_credited", e.target.checked)}
        />
      </ListSection>

      <ListSection header="Callbacks & warranty">
        <ToggleRow
          title="Callbacks are no-charge"
          subtitle="Default for jobs created as a callback"
          checked={v.callback_no_charge}
          onChange={(e) => set("callback_no_charge", e.target.checked)}
        />
        <div className="px-4 py-3">
          <TextField
            label="Warranty claim due (days)"
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            value={nums.warranty_claim_due_days}
            error={err("warranty_claim_due_days")}
            onChange={(e) => setNum("warranty_claim_due_days", e.target.value)}
          />
        </div>
      </ListSection>

      <ListSection
        header="Schedule board"
        footer="Visible hours on the desktop board (company time zone)."
      >
        <div className="grid grid-cols-2 gap-3 px-4 py-3">
          <Select
            label="Starts"
            value={String(v.board_start_hour)}
            options={Array.from({ length: 24 }, (_, h) => ({
              value: String(h),
              label: hourLabel(h),
            }))}
            onChange={(e) => set("board_start_hour", Number(e.target.value))}
          />
          <Select
            label="Ends"
            value={String(v.board_end_hour)}
            error={err("board_end_hour")}
            options={Array.from({ length: 24 }, (_, i) => i + 1).map((h) => ({
              value: String(h),
              label: hourLabel(h),
            }))}
            onChange={(e) => set("board_end_hour", Number(e.target.value))}
          />
        </div>
      </ListSection>

      <ListSection
        header="Job numbers"
        footer="New jobs are numbered like J-1001. Existing numbers don't change."
      >
        <div className="px-4 py-3">
          <TextField
            label="Prefix"
            value={v.job_prefix}
            maxLength={8}
            error={err("job_prefix")}
            onChange={(e) => set("job_prefix", e.target.value.toUpperCase())}
          />
        </div>
      </ListSection>

      <div className="fixed inset-x-0 bottom-[calc(var(--tabbar-space)+4px)] z-[var(--z-bar)] px-[var(--gutter)] lg:bottom-4 lg:left-[260px]">
        <div className="material mx-auto max-w-[560px] rounded-[22px] p-2 shadow-[var(--shadow-float)]">
          <Button
            size="lg"
            fullWidth
            loading={pending}
            disabled={!dirty}
            onClick={save}
          >
            {dirty ? "Save changes" : "Saved"}
          </Button>
        </div>
      </div>
    </div>
  );
}
