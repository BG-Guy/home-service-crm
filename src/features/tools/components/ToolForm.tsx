"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { CustomFieldDef } from "@/features/settings/contracts";
import { CustomFieldsFields } from "@/features/settings/slots.client";
import { Button } from "@/ui/components/Button";
import { CameraButton } from "@/ui/components/CameraButton";
import { DateField } from "@/ui/components/DatePicker";
import { Select, TextArea, TextField } from "@/ui/components/Field";
import { ListSection } from "@/ui/components/List";
import { MoneyField } from "@/ui/components/MoneyField";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { getToolLabelResult, readToolLabel, saveTool } from "../actions";
import type { ToolFormValues } from "../contracts";
import { CONDITION_SEGMENTS, newId } from "./util";

export interface ToolFormProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: ToolFormValues | null;
  /** Office/admin: company tools + owner picker. Techs register their own tools. */
  manage: boolean;
  users: { id: string; name: string }[];
  customDefs: CustomFieldDef[];
  aiEnabled: boolean;
  categories: string[];
}

const blank = (manage: boolean): ToolFormValues => ({
  name: "",
  category: null,
  brand: null,
  model: null,
  serial: null,
  purchaseDate: null,
  purchaseCostCents: null,
  replacementCostCents: null,
  owner: manage ? "company" : "tech_owned",
  ownerUserId: null,
  condition: "good",
  calibrationDueOn: null,
  maintenanceIntervalDays: null,
  maintenanceTask: null,
  lastMaintainedOn: null,
  notes: null,
  custom: {},
});

/** Add / edit a tool: photo first (required), optional AI label read, then details. */
export default function ToolForm({
  open,
  onOpenChange,
  initial,
  manage,
  users,
  customDefs,
  aiEnabled,
  categories,
}: ToolFormProps) {
  const router = useRouter();
  const isNew = !initial?.id;
  const [id] = useState(() => initial?.id ?? newId());
  const [v, setV] = useState<ToolFormValues>(() => initial ?? blank(manage));
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [reading, setReading] = useState(false);
  const set = <K extends keyof ToolFormValues>(
    k: K,
    val: ToolFormValues[K],
  ) => {
    setDirty(true);
    setV((x) => ({ ...x, [k]: val }));
  };
  const s = (x: string | number | null | undefined) =>
    x == null ? "" : String(x);
  const fe = (k: string) => errors?.[k]?.[0];

  const readLabel = async (mediaId: string) => {
    setReading(true);
    try {
      const r = await readToolLabel({ mediaId, toolId: id });
      if (!r.ok || !r.data) return;
      for (let i = 0; i < 15; i++) {
        const res = await getToolLabelResult(r.data.aiTaskId);
        if (res.status === "done") {
          setV((x) => ({
            ...x,
            brand: x.brand || res.brand,
            model: x.model || res.model,
            serial: x.serial || res.serial,
          }));
          toast({
            title: "Label read — please check",
            message:
              [res.brand, res.model, res.serial].filter(Boolean).join(" · ") ||
              "Nothing readable",
            tone: "success",
          });
          return;
        }
        if (res.status === "failed" || res.status.startsWith("skipped")) return;
        await new Promise((ok) => setTimeout(ok, 1500));
      }
    } finally {
      setReading(false);
    }
  };

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const custom = Object.fromEntries(
      [...fd.entries()]
        .filter(([k]) => k.startsWith("custom."))
        .map(([k, val]) => [k.slice(7), val]),
    );
    start(async () => {
      const r = await saveTool({ ...v, id, isNew, custom });
      if (!r.ok) {
        setErrors(r.fieldErrors);
        toast({ title: r.fieldErrors?.photo?.[0] ?? r.error, tone: "error" });
        return;
      }
      toast({ title: isNew ? "Tool added" : "Tool saved", tone: "success" });
      setDirty(false);
      onOpenChange(false);
      if (isNew) router.push(`/tools/${id}`);
    });
  };

  const formId = `tool-${id}`;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={isNew ? "New tool" : "Edit tool"}
      dirty={dirty}
      desktop="panel"
      leading={
        <Button variant="plain" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      }
      footer={
        <Button
          type="submit"
          form={formId}
          size="lg"
          fullWidth
          loading={pending}
        >
          {isNew ? "Add tool" : "Save"}
        </Button>
      }
    >
      <form
        id={formId}
        onSubmit={submit}
        className="flex flex-col gap-5 pb-6 pt-1"
      >
        <div className="flex flex-col gap-2">
          <span className="text-subhead font-semibold">
            Photos{isNew && <span className="text-danger"> *</span>}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <CameraButton
              kind="photo"
              tag="tool"
              entity={{ type: "tool", id }}
              label={
                photoIds.length
                  ? `Add photo (${photoIds.length})`
                  : "Photo of the tool"
              }
              variant="tinted"
              showLibrary
              geo={false}
              onUploaded={(r) => {
                setPhotoIds((p) => [...p, r.mediaId]);
                setErrors(undefined);
              }}
              onError={(err) =>
                toast({
                  title: "Photo failed",
                  message: err.message,
                  tone: "error",
                })
              }
            />
            {aiEnabled && photoIds.length > 0 && (
              <Button
                variant="plain"
                size="sm"
                loading={reading}
                icon={<Sparkles size={15} aria-hidden />}
                onClick={() =>
                  readLabel(photoIds[photoIds.length - 1] as string)
                }
              >
                Read label
              </Button>
            )}
          </div>
          <p className="text-footnote text-label-2">
            {aiEnabled
              ? "Snap the nameplate too — AI can fill brand, model and serial for you to check."
              : "Include the nameplate so the serial number is on record."}
          </p>
          {fe("photo") && (
            <p role="alert" className="text-footnote text-danger">
              {fe("photo")}
            </p>
          )}
        </div>
        <TextField
          label="Name"
          value={v.name}
          placeholder="Cordless drill"
          onChange={(e) => set("name", e.currentTarget.value)}
          error={fe("name")}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Category"
            list="tool-cats"
            value={s(v.category)}
            onChange={(e) => set("category", e.currentTarget.value || null)}
          />
          <datalist id="tool-cats">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <TextField
            label="Brand"
            value={s(v.brand)}
            onChange={(e) => set("brand", e.currentTarget.value || null)}
          />
          <TextField
            label="Model"
            value={s(v.model)}
            onChange={(e) => set("model", e.currentTarget.value || null)}
          />
          <TextField
            label="Serial #"
            value={s(v.serial)}
            autoCapitalize="characters"
            onChange={(e) => set("serial", e.currentTarget.value || null)}
          />
        </div>
        {manage && (
          <ListSection header="Ownership">
            <div className="flex flex-col gap-3 p-4">
              <SegmentedControl
                label="Owner"
                value={v.owner}
                segments={[
                  { value: "company", label: "Company" },
                  { value: "tech_owned", label: "Tech-owned" },
                ]}
                onChange={(o) => set("owner", o)}
              />
              {v.owner === "tech_owned" && (
                <Select
                  label="Owned by"
                  value={s(v.ownerUserId)}
                  placeholder="Pick a tech"
                  options={users.map((u) => ({ value: u.id, label: u.name }))}
                  onChange={(e) =>
                    set("ownerUserId", e.currentTarget.value || null)
                  }
                />
              )}
            </div>
          </ListSection>
        )}
        <SegmentedControl
          label="Condition"
          value={v.condition}
          segments={CONDITION_SEGMENTS}
          onChange={(c) => set("condition", c)}
        />
        <div className="grid grid-cols-2 gap-3">
          <DateField
            label="Purchased"
            value={s(v.purchaseDate)}
            onChange={(e) => set("purchaseDate", e.currentTarget.value || null)}
          />
          <MoneyField
            label="Purchase cost"
            valueCents={v.purchaseCostCents}
            onChangeCents={(c) => set("purchaseCostCents", c)}
          />
          <MoneyField
            label="Replacement value"
            valueCents={v.replacementCostCents}
            onChangeCents={(c) => set("replacementCostCents", c)}
          />
          <DateField
            label="Calibration due"
            value={s(v.calibrationDueOn)}
            onChange={(e) =>
              set("calibrationDueOn", e.currentTarget.value || null)
            }
          />
        </div>
        <ListSection
          header="Maintenance"
          footer="Logging maintenance resets the due date. Leave empty if this tool needs none."
        >
          <div className="grid grid-cols-2 gap-3 p-4">
            <TextField
              label="Task"
              placeholder="Replace blades"
              value={s(v.maintenanceTask)}
              onChange={(e) =>
                set("maintenanceTask", e.currentTarget.value || null)
              }
            />
            <TextField
              label="Every (days)"
              inputMode="numeric"
              value={s(v.maintenanceIntervalDays)}
              onChange={(e) => {
                const d = e.currentTarget.value.replace(/[^\d]/g, "");
                set("maintenanceIntervalDays", d ? Number(d) : null);
              }}
            />
            <DateField
              label="Last done"
              value={s(v.lastMaintainedOn)}
              onChange={(e) =>
                set("lastMaintainedOn", e.currentTarget.value || null)
              }
            />
          </div>
        </ListSection>
        <TextArea
          label="Notes"
          rows={3}
          value={s(v.notes)}
          onChange={(e) => set("notes", e.currentTarget.value || null)}
        />
        {customDefs.length > 0 && (
          <CustomFieldsFields defs={customDefs} values={v.custom} />
        )}
      </form>
    </Sheet>
  );
}
