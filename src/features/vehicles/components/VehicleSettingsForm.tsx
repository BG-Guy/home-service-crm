"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { SaveBar } from "@/features/settings/components/SaveBar";
import { Button } from "@/ui/components/Button";
import { Select, TextField } from "@/ui/components/Field";
import { IconButton } from "@/ui/components/IconButton";
import { ListGroup, ListSection } from "@/ui/components/List";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { toast } from "@/ui/components/Toast";
import { Toggle } from "@/ui/components/Toggle";
import { saveVehicleSettings } from "../actions";
import { taskLabel, VEHICLE_LOG_TYPES, type VehicleLogType } from "../rules";

type Approval = "auto" | "auto_if_evidence" | "always_review";
interface Policy {
  tech_can_log: boolean;
  approval: Approval;
  ai_optional: boolean;
}
interface Seed {
  task: string;
  interval_miles: number | null;
  interval_days: number | null;
  due_soon_miles: number | null;
  due_soon_days: number | null;
}
export interface VehicleSettingsValues {
  policies: Record<VehicleLogType, Policy>;
  inspection_frequency: "none" | "daily" | "weekly";
  require_odometer_on_clock: boolean;
  max_daily_miles: number;
  anomaly: { weekend_fuel: boolean; mpg_drop_pct: number };
  issue_ack_target_minutes: number;
  reminder_seeds: Seed[];
}

const TYPE_LABEL: Record<VehicleLogType, string> = {
  odometer: "Odometer",
  fuel: "Fuel",
  service: "Service",
  document: "Documents",
  inspection: "Inspections",
  trip: "Trips",
};

const APPROVAL_OPTIONS = [
  { value: "auto", label: "Approve automatically" },
  { value: "auto_if_evidence", label: "Auto if photo checks out" },
  { value: "always_review", label: "Always review" },
];

function Row({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="list-row flex min-h-11 items-center justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <p className="text-body">{title}</p>
        {subtitle && <p className="text-footnote text-label-2">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/** /settings/vehicles: per-entry approval policies, inspections, anomalies, reminder seeds. */
export function VehicleSettingsForm({
  initial,
  aiEnabled,
}: {
  initial: VehicleSettingsValues;
  aiEnabled: boolean;
}) {
  const [s, setS] = useState(initial);
  // Number fields keep what was typed (no snapping to 0); the server validates
  // the range and its field errors land on these inputs (QA T3-15).
  const [nums, setNums] = useState({
    max_daily_miles: String(initial.max_daily_miles),
    mpg_drop_pct: String(initial.anomaly.mpg_drop_pct),
    issue_ack_target_minutes: String(initial.issue_ack_target_minutes),
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const patch = (p: Partial<VehicleSettingsValues>) => {
    setDirty(true);
    setS((x) => ({ ...x, ...p }));
  };
  const setNum = (k: keyof typeof nums, v: string) => {
    setDirty(true);
    setNums((x) => ({ ...x, [k]: v.replace(/[^\d]/g, "") }));
  };
  const err = (k: string) => errors[k]?.[0];
  const setPolicy = (t: VehicleLogType, p: Partial<Policy>) =>
    patch({ policies: { ...s.policies, [t]: { ...s.policies[t], ...p } } });
  const setSeed = (i: number, p: Partial<Seed>) =>
    patch({
      reminder_seeds: s.reminder_seeds.map((x, j) =>
        j === i ? { ...x, ...p } : x,
      ),
    });
  const int = (v: string) => {
    const d = v.replace(/[^\d]/g, "");
    return d ? Number(d) : null;
  };

  const save = () =>
    start(async () => {
      const seeds = s.reminder_seeds.filter((x) => x.task.trim());
      const r = await saveVehicleSettings({
        ...s,
        max_daily_miles: nums.max_daily_miles,
        anomaly: { ...s.anomaly, mpg_drop_pct: nums.mpg_drop_pct },
        issue_ack_target_minutes: nums.issue_ack_target_minutes,
        reminder_seeds: seeds,
      });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        toast({
          title: r.fieldErrors
            ? "Check the highlighted fields"
            : r.error || "Couldn’t save",
          tone: "error",
        });
        return;
      }
      setErrors({});
      setS((x) => ({ ...x, reminder_seeds: seeds }));
      setDirty(false);
      toast({ title: "Vehicle settings saved", tone: "success" });
    });

  return (
    <div className="flex flex-col gap-6 pb-24">
      <ListGroup>
        <ListSection
          header="Who logs, and who approves"
          footer="Admins’ own entries are always approved (and audited). A rules-first anomaly — odometer going backwards, gallons over the tank, two fills in a day — always sends an entry to review."
        >
          {VEHICLE_LOG_TYPES.map((t) => (
            <div key={t} className="list-row flex flex-col gap-2 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-headline">{TYPE_LABEL[t]}</p>
                <div className="flex items-center gap-2 text-footnote text-label-2">
                  Techs can log
                  <Toggle
                    label={`Techs can log ${TYPE_LABEL[t].toLowerCase()}`}
                    checked={s.policies[t].tech_can_log}
                    onChange={(e) =>
                      setPolicy(t, { tech_can_log: e.currentTarget.checked })
                    }
                  />
                </div>
              </div>
              <Select
                label="Approval"
                hideLabel
                value={s.policies[t].approval}
                options={APPROVAL_OPTIONS}
                onChange={(e) =>
                  setPolicy(t, {
                    approval: e.currentTarget.value as Approval,
                  })
                }
              />
              {s.policies[t].approval === "auto_if_evidence" &&
                (t === "odometer" || t === "fuel" || t === "service") && (
                  <div className="flex items-center justify-between gap-3 text-footnote text-label-2">
                    <span>
                      Approve on photo alone when the AI check is unavailable
                      {!aiEnabled && " (AI is off)"}
                    </span>
                    <Toggle
                      label="AI check optional"
                      checked={s.policies[t].ai_optional}
                      onChange={(e) =>
                        setPolicy(t, { ai_optional: e.currentTarget.checked })
                      }
                    />
                  </div>
                )}
            </div>
          ))}
        </ListSection>

        <ListSection header="Inspections and clock">
          <div className="px-4 py-3">
            <SegmentedControl
              label="Inspection frequency"
              value={s.inspection_frequency}
              segments={[
                { value: "none", label: "Off" },
                { value: "daily", label: "Daily" },
                { value: "weekly", label: "Weekly" },
              ]}
              onChange={(v) => patch({ inspection_frequency: v })}
            />
          </div>
          <Row
            title="Odometer photo at clock in/out"
            subtitle="Feeds the IRS mileage log automatically."
          >
            <Toggle
              label="Require odometer on clock"
              checked={s.require_odometer_on_clock}
              onChange={(e) =>
                patch({ require_odometer_on_clock: e.currentTarget.checked })
              }
            />
          </Row>
        </ListSection>

        <ListSection header="Anomaly rules">
          <Row title="Max daily miles" subtitle="More than this flags a jump.">
            <TextField
              label="Max daily miles"
              hideLabel
              inputMode="numeric"
              className="w-24"
              value={nums.max_daily_miles}
              error={err("max_daily_miles")}
              onChange={(e) => setNum("max_daily_miles", e.currentTarget.value)}
            />
          </Row>
          <Row title="MPG drop %" subtitle="Flag fills this far below average.">
            <TextField
              label="MPG drop percent"
              hideLabel
              inputMode="numeric"
              className="w-24"
              value={nums.mpg_drop_pct}
              error={err("anomaly.mpg_drop_pct")}
              onChange={(e) => setNum("mpg_drop_pct", e.currentTarget.value)}
            />
          </Row>
          <Row title="Flag weekend fuel">
            <Toggle
              label="Flag weekend fuel"
              checked={s.anomaly.weekend_fuel}
              onChange={(e) =>
                patch({
                  anomaly: {
                    ...s.anomaly,
                    weekend_fuel: e.currentTarget.checked,
                  },
                })
              }
            />
          </Row>
          <Row
            title="Issue response target (min)"
            subtitle="The timer turns red after this."
          >
            <TextField
              label="Issue response target minutes"
              hideLabel
              inputMode="numeric"
              className="w-24"
              value={nums.issue_ack_target_minutes}
              error={err("issue_ack_target_minutes")}
              onChange={(e) =>
                setNum("issue_ack_target_minutes", e.currentTarget.value)
              }
            />
          </Row>
        </ListSection>

        <ListSection
          header="Reminder seeds for new vehicles"
          footer="Whichever comes first. Registration, insurance and inspection follow the document expiry dates."
        >
          {s.reminder_seeds.map((seed, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place
              key={i}
              className="list-row flex flex-col gap-2 px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <TextField
                  label="Task"
                  hideLabel
                  className="flex-1"
                  value={seed.task}
                  placeholder="Oil change"
                  hint={seed.task ? taskLabel(seed.task) : undefined}
                  error={err(`reminder_seeds.${i}.task`)}
                  onChange={(e) => setSeed(i, { task: e.currentTarget.value })}
                />
                <IconButton
                  label={`Remove ${taskLabel(seed.task || "reminder")}`}
                  onClick={() =>
                    patch({
                      reminder_seeds: s.reminder_seeds.filter(
                        (_, j) => j !== i,
                      ),
                    })
                  }
                >
                  <Trash2 size={18} aria-hidden />
                </IconButton>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    ["interval_miles", "Every mi"],
                    ["interval_days", "Every days"],
                    ["due_soon_miles", "Soon mi"],
                    ["due_soon_days", "Soon days"],
                  ] as const
                ).map(([k, label]) => (
                  <TextField
                    key={k}
                    label={label}
                    inputMode="numeric"
                    value={seed[k] == null ? "" : String(seed[k])}
                    error={err(`reminder_seeds.${i}.${k}`)}
                    onChange={(e) =>
                      setSeed(i, { [k]: int(e.currentTarget.value) })
                    }
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="px-2 py-1">
            <Button
              variant="plain"
              size="sm"
              icon={<Plus size={16} aria-hidden />}
              onClick={() =>
                patch({
                  reminder_seeds: [
                    ...s.reminder_seeds,
                    {
                      task: "",
                      interval_miles: null,
                      interval_days: null,
                      due_soon_miles: null,
                      due_soon_days: null,
                    },
                  ],
                })
              }
            >
              Add seed
            </Button>
          </div>
        </ListSection>
      </ListGroup>
      <SaveBar
        dirty={dirty}
        pending={pending}
        disabled={!dirty}
        onSave={save}
      />
    </div>
  );
}
