"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { TextArea, TextField } from "@/ui/components/Field";
import { IconButton } from "@/ui/components/IconButton";
import { ListGroup, ListSection } from "@/ui/components/List";
import { Stepper } from "@/ui/components/Stepper";
import { toast } from "@/ui/components/Toast";
import { Toggle } from "@/ui/components/Toggle";
import { saveToolSettings } from "../actions";

export interface ToolSettingsValues {
  audit_frequency_days: number;
  deductions_enabled: boolean;
  agreement_text: string | null;
  block_on_calibration_overdue: boolean;
  require_handoff_photo: boolean;
  maintenance_warning_days: number;
  maintenance_interval_days_by_category: Record<string, number>;
}

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

/** /settings/tools: audits, handoff rules, maintenance defaults, ⚖️ deductions and agreement text. */
export function ToolSettingsForm({
  initial,
  defaultAgreement,
  w2Blocked,
}: {
  initial: ToolSettingsValues;
  defaultAgreement: string;
  /** Company state blocks W-2 wage deductions (compliance profile). */
  w2Blocked: string | null;
}) {
  const [s, setS] = useState(initial);
  const [cats, setCats] = useState(() =>
    Object.entries(initial.maintenance_interval_days_by_category)
      .filter(([, d]) => d > 0)
      .map(([category, days]) => ({ category, days })),
  );
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const set = (p: Partial<ToolSettingsValues>) => {
    setDirty(true);
    setS((x) => ({ ...x, ...p }));
  };
  const save = () =>
    start(async () => {
      // Settings records merge, so removed categories are saved as 0 (= no default).
      const map: Record<string, number> = Object.fromEntries(
        Object.keys(initial.maintenance_interval_days_by_category).map((k) => [
          k,
          0,
        ]),
      );
      for (const c of cats)
        if (c.category.trim()) map[c.category.trim()] = c.days;
      const r = await saveToolSettings({
        ...s,
        maintenance_interval_days_by_category: map,
      });
      if (!r.ok) toast({ title: r.error, tone: "error" });
      else {
        setDirty(false);
        toast({ title: "Tool settings saved", tone: "success" });
      }
    });
  return (
    <div className="flex flex-col gap-6">
      <ListGroup>
        <ListSection
          header="Tool checks"
          footer="Each tech with company tools gets a checklist: one timestamped photo per tool. Missing tools become incidents."
        >
          <Row title="Every" subtitle={`${s.audit_frequency_days} days`}>
            <Stepper
              label="Audit frequency in days"
              value={s.audit_frequency_days}
              min={7}
              max={180}
              step={1}
              onChange={(v) => set({ audit_frequency_days: v })}
              format={(n) => `${n} d`}
            />
          </Row>
        </ListSection>
        <ListSection header="Handoffs">
          <Row title="Photo at every check-out / check-in">
            <Toggle
              label="Require handoff photo"
              checked={s.require_handoff_photo}
              onChange={(e) =>
                set({ require_handoff_photo: e.currentTarget.checked })
              }
            />
          </Row>
          <Row title="Block check-out when calibration is overdue">
            <Toggle
              label="Block on overdue calibration"
              checked={s.block_on_calibration_overdue}
              onChange={(e) =>
                set({ block_on_calibration_overdue: e.currentTarget.checked })
              }
            />
          </Row>
        </ListSection>
        <ListSection
          header="Maintenance"
          footer="Default intervals by category apply to new tools without their own interval."
        >
          <Row
            title="Remind"
            subtitle={`${s.maintenance_warning_days} days before, and on the day`}
          >
            <Stepper
              label="Reminder days before"
              value={s.maintenance_warning_days}
              min={0}
              max={30}
              onChange={(v) => set({ maintenance_warning_days: v })}
              format={(n) => `${n} d`}
            />
          </Row>
          {cats.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place
            <div key={i} className="list-row flex items-center gap-2 px-4 py-2">
              <TextField
                label="Category"
                hideLabel
                className="flex-1"
                placeholder="Power tools"
                value={c.category}
                onChange={(e) => {
                  setDirty(true);
                  const v = e.currentTarget.value;
                  setCats((l) =>
                    l.map((x, j) => (j === i ? { ...x, category: v } : x)),
                  );
                }}
              />
              <TextField
                label="Days"
                hideLabel
                className="w-24"
                inputMode="numeric"
                trailing={<span className="text-footnote text-label-2">d</span>}
                value={String(c.days)}
                onChange={(e) => {
                  setDirty(true);
                  const v =
                    Number(e.currentTarget.value.replace(/[^\d]/g, "")) || 0;
                  setCats((l) =>
                    l.map((x, j) => (j === i ? { ...x, days: v } : x)),
                  );
                }}
              />
              <IconButton
                label={`Remove ${c.category || "category"}`}
                onClick={() => {
                  setDirty(true);
                  setCats((l) => l.filter((_, j) => j !== i));
                }}
              >
                <Trash2 size={18} aria-hidden />
              </IconButton>
            </div>
          ))}
          <div className="px-2 py-1">
            <Button
              variant="plain"
              size="sm"
              icon={<Plus size={16} aria-hidden />}
              onClick={() => setCats((l) => [...l, { category: "", days: 90 }])}
            >
              Add category default
            </Button>
          </div>
        </ListSection>
        <ListSection header="Deductions ⚖️">
          <div className="flex flex-col gap-3 p-4">
            <Banner tone="legal" title="Off by default">
              Deducting lost or damaged tools from pay is restricted for W-2
              employees in many states and needs a signed tool agreement. A
              “tech responsibility” decision only creates a pending deduction
              for payroll review.
              {w2Blocked
                ? ` Your compliance profile (${w2Blocked}) blocks W-2 deductions.`
                : ""}
            </Banner>
            <div className="flex min-h-11 items-center justify-between gap-3">
              <span className="text-body">Allow tool deductions</span>
              <Toggle
                label="Allow tool deductions"
                checked={s.deductions_enabled}
                onChange={(e) =>
                  set({ deductions_enabled: e.currentTarget.checked })
                }
              />
            </div>
          </div>
        </ListSection>
        <ListSection
          header="Tool agreement"
          footer="Techs sign this from Tools → My tools. Leave empty to use the default text."
        >
          <div className="p-4">
            <TextArea
              label="Agreement text"
              hideLabel
              rows={5}
              placeholder={defaultAgreement}
              value={s.agreement_text ?? ""}
              onChange={(e) =>
                set({ agreement_text: e.currentTarget.value || null })
              }
            />
          </div>
        </ListSection>
      </ListGroup>
      <Button
        size="lg"
        fullWidth
        loading={pending}
        disabled={!dirty}
        onClick={save}
      >
        Save changes
      </Button>
    </div>
  );
}
