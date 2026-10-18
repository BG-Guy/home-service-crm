"use client";

import { Braces, Eye, Plus, Send, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { EVENT_TYPES } from "@/lib/event-types";
import { useConfirm } from "@/ui/components/Alert";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { Select, TextArea, TextField, TimeField } from "@/ui/components/Field";
import { IconButton } from "@/ui/components/IconButton";
import { ListSection } from "@/ui/components/List";
import { MessageBubble } from "@/ui/components/MessageBubble";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import {
  deleteAutomation,
  previewAutomation,
  type StepPreview,
  saveAutomation,
  saveAutomationJson,
  sendAutomationTest,
  setAutomationEnabled,
} from "../actions";
import { CONDITION_OPS, type ConditionLeaf, OP_LABELS } from "../conditions";
import { normalizeCancelOn } from "../engine-shared";
import { eventLabel, triggerLabel } from "../event-labels";
import { ANCHOR_LABELS, ANCHORS, type EngineStep } from "../schedule";
import { AUDIENCE_OPTIONS, CHANNEL_OPTIONS } from "../variables";

export interface AutomationDTO {
  id: string;
  key: string;
  name: string;
  description: string | null;
  triggerEvent: string;
  conditions: unknown;
  steps: EngineStep[];
  cancelOn: unknown;
  featureFlag: string | null;
  enabled: boolean;
  builtin: boolean;
}

type Unit = "minutes" | "hours" | "days";

function delayParts(d: EngineStep["delay"]): {
  amount: number;
  unit: Unit;
  before: boolean;
} {
  const e = Object.entries(d ?? {}).filter(([, v]) => v);
  if (e.length === 1) {
    const [unit, v] = e[0] as [Unit, number];
    return { amount: Math.abs(v), unit, before: v < 0 };
  }
  const total =
    (d?.days ?? 0) * 1440 + (d?.hours ?? 0) * 60 + (d?.minutes ?? 0);
  return { amount: Math.abs(total), unit: "minutes", before: total < 0 };
}

const COMMON_FIELDS = [
  "job.status",
  "job.priority",
  "job.service_type_id",
  "job.payment_status",
  "job.is_callback",
  "job.after_hours",
  "customer.type",
  "customer.tags",
  "customer.vip",
  "customer.sms_status",
  "lead.source",
  "lead.is_returning",
  "invoice.balance_cents",
  "estimate.total_cents",
  "payment.method",
  "service_type.name",
  "property.zip",
  "event.via",
  "event.after_hours",
  "event.after_arrival",
  "event.rating",
];

const CHANNEL_CHOICES = [
  ...CHANNEL_OPTIONS,
  { value: "customer_preferred+email", label: "Preferred + email copy" },
  { value: "push+in_app", label: "Push + in-app" },
  { value: "push+email", label: "Push + email" },
];

function flatConditions(
  c: unknown,
): { mode: "all" | "any"; rows: ConditionLeaf[] } | null {
  if (!c || (typeof c === "object" && Object.keys(c as object).length === 0))
    return { mode: "all", rows: [] };
  const g = c as { all?: unknown[]; any?: unknown[]; field?: string };
  if (typeof g.field === "string")
    return { mode: "all", rows: [c as ConditionLeaf] };
  const list = g.all ?? g.any;
  const mode = g.any ? "any" : "all";
  if (!Array.isArray(list) || Object.keys(g).length !== 1) return null;
  if (!list.every((x) => x && typeof (x as ConditionLeaf).field === "string"))
    return null;
  return { mode, rows: list as ConditionLeaf[] };
}

export function AutomationEditor({
  automation: a,
  templates,
  perms,
  roles,
  isAdmin,
}: {
  automation: AutomationDTO;
  templates: { key: string; label: string; purpose: string }[];
  perms: string[];
  roles: { key: string; name: string }[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const listId = useId();
  const [confirm, dialog] = useConfirm();
  const [name, setName] = useState(a.name);
  const [description, setDescription] = useState(a.description ?? "");
  const [trigger, setTrigger] = useState(a.triggerEvent);
  const [enabled, setEnabled] = useState(a.enabled);
  const flat = useMemo(() => flatConditions(a.conditions), [a.conditions]);
  const [condMode, setCondMode] = useState<"all" | "any">(flat?.mode ?? "all");
  const [conds, setConds] = useState<ConditionLeaf[]>(flat?.rows ?? []);
  const [steps, setSteps] = useState<EngineStep[]>(a.steps);
  const [cancelOn, setCancelOn] = useState<unknown[]>(
    Array.isArray(a.cancelOn) ? (a.cancelOn as unknown[]) : [],
  );
  const [newCancel, setNewCancel] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<{
    jobNumber: string | null;
    steps: StepPreview[];
  } | null>(null);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [json, setJson] = useState("");

  const body = () => ({
    name,
    description: description || null,
    triggerEvent: trigger,
    conditions: flat
      ? conds.length
        ? { [condMode]: conds }
        : {}
      : a.conditions,
    steps,
    cancelOn,
  });

  const setStep = (i: number, patch: Partial<EngineStep>) =>
    setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const save = async () => {
    setSaving(true);
    const res = await saveAutomation({ id: a.id, ...body() });
    setSaving(false);
    if (res.ok) {
      setErrors({});
      toast({ title: "Automation saved", tone: "success" });
      router.refresh();
    } else {
      setErrors(res.fieldErrors ?? {});
      toast({ title: "Not saved", message: res.error, tone: "error" });
    }
  };

  const openPreview = async () => {
    setPreviewOpen(true);
    setPreview(null);
    const res = await previewAutomation({ id: a.id });
    if (res.ok && res.data) setPreview(res.data);
    else if (!res.ok)
      toast({ title: "Preview failed", message: res.error, tone: "error" });
  };

  const audienceOptions = [
    ...AUDIENCE_OPTIONS.map((o) => o.value),
    "office+assigned_tech",
    "admins+subject_user",
    ...roles.map((r) => `role:${r.key}`),
    ...perms.map((p) => `perm:${p}`),
  ];

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <datalist id={`${listId}-events`}>
        {[...EVENT_TYPES, "schedule.daily"].map((e) => (
          <option key={e} value={e} label={eventLabel(e)} />
        ))}
      </datalist>
      <datalist id={`${listId}-aud`}>
        {audienceOptions.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <datalist id={`${listId}-fields`}>
        {COMMON_FIELDS.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>

      <ListSection>
        <ToggleRow
          title="On"
          subtitle={a.builtin ? "Built-in automation" : "Custom automation"}
          checked={enabled}
          onChange={async (e) => {
            const next = e.currentTarget.checked;
            setEnabled(next);
            const res = await setAutomationEnabled({ id: a.id, enabled: next });
            if (!res.ok) {
              setEnabled(!next);
              toast({
                title: "Couldn't change it",
                message: res.error,
                tone: "error",
              });
            }
          }}
        />
        <div className="flex flex-col gap-3 px-4 py-3">
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <TextArea
            label="Description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />
        </div>
      </ListSection>

      <ListSection
        header="When this happens"
        footer="Separate several events with | (for example job.scheduled|job.rescheduled)."
      >
        <div className="px-4 py-3">
          <TextField
            label="Trigger event"
            value={trigger}
            list={`${listId}-events`}
            hint={trigger.trim() ? triggerLabel(trigger) : undefined}
            error={errors.triggerEvent}
            onChange={(e) => setTrigger(e.currentTarget.value)}
          />
        </div>
      </ListSection>

      <ListSection header="Only if" footer="Leave empty to run every time.">
        {flat ? (
          <div className="flex flex-col gap-3 px-4 py-3">
            {conds.length > 1 && (
              <SegmentedControl
                label="Match"
                value={condMode}
                segments={[
                  { value: "all", label: "All of these" },
                  { value: "any", label: "Any of these" },
                ]}
                onChange={setCondMode}
              />
            )}
            {conds.map((c, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
                key={i}
                className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[2fr_1fr_2fr_auto]"
              >
                <TextField
                  label="Field"
                  hideLabel
                  placeholder="job.status"
                  list={`${listId}-fields`}
                  value={c.field}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    setConds((p) =>
                      p.map((x, j) => (j === i ? { ...x, field: v } : x)),
                    );
                  }}
                />
                <Select
                  label="Operator"
                  hideLabel
                  value={c.op}
                  options={CONDITION_OPS.map((o) => ({
                    value: o,
                    label: OP_LABELS[o],
                  }))}
                  onChange={(e) => {
                    const v = e.currentTarget.value as ConditionLeaf["op"];
                    setConds((p) =>
                      p.map((x, j) => (j === i ? { ...x, op: v } : x)),
                    );
                  }}
                />
                {c.op !== "exists" && c.op !== "not_exists" ? (
                  <TextField
                    label="Value"
                    hideLabel
                    placeholder={
                      c.op === "in" || c.op === "nin" ? "a, b, c" : "value"
                    }
                    value={
                      Array.isArray(c.value)
                        ? c.value.join(", ")
                        : String(c.value ?? "")
                    }
                    onChange={(e) => {
                      const raw = e.currentTarget.value;
                      const v =
                        c.op === "in" || c.op === "nin"
                          ? raw
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean)
                          : /^-?\d+(\.\d+)?$/.test(raw)
                            ? Number(raw)
                            : raw === "true" || raw === "false"
                              ? raw === "true"
                              : raw;
                      setConds((p) =>
                        p.map((x, j) => (j === i ? { ...x, value: v } : x)),
                      );
                    }}
                  />
                ) : (
                  <span />
                )}
                <IconButton
                  label="Remove condition"
                  onClick={() => setConds((p) => p.filter((_, j) => j !== i))}
                >
                  <X aria-hidden size={18} />
                </IconButton>
              </div>
            ))}
            {errors.conditions && (
              <p className="text-footnote text-danger">
                {errors.conditions.join(" ")}
              </p>
            )}
            <Button
              variant="plain"
              size="sm"
              className="self-start"
              icon={<Plus aria-hidden size={16} />}
              onClick={() =>
                setConds((p) => [
                  ...p,
                  { field: "job.status", op: "eq", value: "" },
                ])
              }
            >
              Add condition
            </Button>
          </div>
        ) : (
          <div className="px-4 py-3">
            <Banner tone="info">
              These conditions are nested. Edit them in the raw JSON view.
            </Banner>
          </div>
        )}
      </ListSection>

      {steps.map((s, i) => {
        const d = delayParts(s.delay);
        const anchor = s.anchor ?? "event_time";
        const anchorOpts = [
          ...ANCHORS.map((x) => ({ value: x, label: ANCHOR_LABELS[x] })),
          ...(!(ANCHORS as readonly string[]).includes(anchor)
            ? [{ value: anchor, label: anchor }]
            : []),
        ];
        const chanOpts = CHANNEL_CHOICES.some((c) => c.value === s.channel)
          ? CHANNEL_CHOICES
          : [...CHANNEL_CHOICES, { value: s.channel, label: s.channel }];
        const advanced = [
          s.only_on?.length ? `only on ${s.only_on.join(", ")}` : null,
          s.when ? "extra condition" : null,
          s.dedupe ? `${s.dedupe} dedupe` : null,
          s.delay_months_field ? `+ months from ${s.delay_months_field}` : null,
        ].filter(Boolean);
        return (
          <ListSection
            // biome-ignore lint/suspicious/noArrayIndexKey: steps are positional
            key={i}
            header={`Step ${i + 1}`}
            footer={
              advanced.length
                ? `Advanced: ${advanced.join(" · ")} (kept as is).`
                : undefined
            }
            trailing={
              steps.length > 1 ? (
                <Button
                  variant="plain"
                  size="sm"
                  onClick={() => setSteps((p) => p.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              ) : undefined
            }
          >
            <div className="grid gap-3 px-4 py-3 sm:grid-cols-4">
              <TextField
                label="Wait"
                inputMode="numeric"
                value={String(d.amount)}
                onChange={(e) => {
                  const n =
                    Number(e.currentTarget.value.replace(/\D/g, "")) || 0;
                  setStep(i, {
                    delay: n ? { [d.unit]: d.before ? -n : n } : {},
                  });
                }}
              />
              <Select
                label="Unit"
                value={d.unit}
                options={[
                  { value: "minutes", label: "minutes" },
                  { value: "hours", label: "hours" },
                  { value: "days", label: "days" },
                ]}
                onChange={(e) => {
                  const u = e.currentTarget.value as Unit;
                  setStep(i, {
                    delay: d.amount
                      ? { [u]: d.before ? -d.amount : d.amount }
                      : {},
                  });
                }}
              />
              <Select
                label="Direction"
                value={d.before ? "before" : "after"}
                options={[
                  { value: "after", label: "after" },
                  { value: "before", label: "before" },
                ]}
                onChange={(e) => {
                  const before = e.currentTarget.value === "before";
                  setStep(i, {
                    delay: d.amount
                      ? { [d.unit]: before ? -d.amount : d.amount }
                      : {},
                  });
                }}
              />
              <Select
                label="From"
                value={anchor}
                options={anchorOpts}
                onChange={(e) => setStep(i, { anchor: e.currentTarget.value })}
              />
              <TimeField
                label="At time (optional)"
                value={s.at ?? ""}
                onChange={(e) =>
                  setStep(i, { at: e.currentTarget.value || undefined })
                }
              />
              <Select
                label="Channel"
                value={s.channel}
                options={chanOpts}
                onChange={(e) => setStep(i, { channel: e.currentTarget.value })}
              />
              <TextField
                label="Send to"
                list={`${listId}-aud`}
                value={s.audience}
                onChange={(e) =>
                  setStep(i, { audience: e.currentTarget.value })
                }
              />
              <Select
                label="Message"
                value={s.template_key}
                options={templates.map((t) => ({
                  value: t.key,
                  label: `${t.label} (${t.key})`,
                }))}
                onChange={(e) =>
                  setStep(i, { template_key: e.currentTarget.value })
                }
              />
            </div>
            {errors[`steps.${i}`] && (
              <p className="px-4 pb-3 text-footnote text-danger">
                {errors[`steps.${i}`]?.join(" ")}
              </p>
            )}
            <div className="flex justify-end px-4 pb-3">
              <Button
                variant="plain"
                size="sm"
                icon={<Send aria-hidden size={14} />}
                onClick={async () => {
                  const res = await sendAutomationTest({
                    id: a.id,
                    stepIndex: i,
                  });
                  toast(
                    res.ok
                      ? {
                          title: "Test sent to you",
                          message: "Check your notifications.",
                          tone: "success",
                        }
                      : {
                          title: "Couldn't send",
                          message: res.error,
                          tone: "error",
                        },
                  );
                }}
              >
                Send test to me
              </Button>
            </div>
          </ListSection>
        );
      })}
      <Button
        variant="plain"
        className="self-start"
        icon={<Plus aria-hidden size={16} />}
        onClick={() =>
          setSteps((p) => [
            ...p,
            {
              delay: { days: 1 },
              channel: p[p.length - 1]?.channel ?? "customer_preferred",
              audience: p[p.length - 1]?.audience ?? "customer",
              template_key:
                p[p.length - 1]?.template_key ?? templates[0]?.key ?? "",
            },
          ])
        }
      >
        Add step
      </Button>

      <ListSection
        header="Stop when"
        footer="Pending messages are canceled when any of these happen."
      >
        <div className="flex flex-col gap-3 px-4 py-3">
          <ChipRow label="Cancel events">
            {normalizeCancelOn(cancelOn).map((r, i) => (
              <Chip
                key={`${r.event}-${i}`}
                selected
                onClick={() => setCancelOn((p) => p.filter((_, j) => j !== i))}
              >
                {eventLabel(r.event)}
                {r.scope && r.scope !== "entity"
                  ? ` (${r.scope.replace("_", " ")})`
                  : ""}
                {r.when ? " (if…)" : ""} ✕
              </Chip>
            ))}
          </ChipRow>
          <div className="flex gap-2">
            <TextField
              label="Add an event"
              hideLabel
              placeholder="invoice.paid"
              list={`${listId}-events`}
              value={newCancel}
              className="flex-1"
              onChange={(e) => setNewCancel(e.currentTarget.value)}
            />
            <Button
              variant="gray"
              disabled={!newCancel.trim()}
              onClick={() => {
                setCancelOn((p) => [...p, newCancel.trim()]);
                setNewCancel("");
              }}
            >
              Add
            </Button>
          </div>
          {errors.cancelOn && (
            <p className="text-footnote text-danger">
              {errors.cancelOn.join(" ")}
            </p>
          )}
        </div>
      </ListSection>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="gray"
            icon={<Eye aria-hidden size={16} />}
            onClick={openPreview}
          >
            Preview with a real job
          </Button>
          {isAdmin && (
            <Button
              variant="gray"
              icon={<Braces aria-hidden size={16} />}
              onClick={() => {
                setJson(JSON.stringify(body(), null, 2));
                setJsonOpen(true);
              }}
            >
              Raw JSON
            </Button>
          )}
          {!a.builtin && (
            <Button
              variant="plain"
              icon={<Trash2 aria-hidden size={16} />}
              onClick={async () => {
                const ok = await confirm({
                  title: "Delete this automation?",
                  message:
                    "Messages it scheduled that haven't gone out are canceled.",
                  confirmLabel: "Delete",
                  destructive: true,
                });
                if (!ok) return;
                const res = await deleteAutomation({ id: a.id });
                if (res.ok) router.push("/settings/automations");
                else
                  toast({
                    title: "Couldn't delete",
                    message: res.error,
                    tone: "error",
                  });
              }}
            >
              Delete
            </Button>
          )}
        </div>
        <Button variant="filled" loading={saving} onClick={save}>
          Save
        </Button>
      </div>

      <Sheet
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title="Preview"
        detents={["large"]}
      >
        <div className="flex flex-col gap-4 pb-8">
          {!preview ? (
            <p className="text-subhead text-label-2">Rendering…</p>
          ) : (
            <>
              <p className="px-1 text-footnote text-label-2">
                {preview.jobNumber
                  ? `Using job ${preview.jobNumber}. Saved text is shown; links are previews.`
                  : "No jobs yet, so job details are blank."}
              </p>
              {preview.steps.map((p) => (
                <section
                  key={p.index}
                  className="rounded-card bg-card p-4 shadow-card"
                >
                  <p className="text-footnote font-semibold uppercase text-label-2">
                    Step {p.index + 1} · {p.when} · {p.channel} → {p.audience}
                  </p>
                  {p.sendAt && (
                    <p className="text-footnote text-label-2">
                      Would go out {new Date(p.sendAt).toLocaleString()}
                    </p>
                  )}
                  {p.subject && (
                    <p className="mt-2 text-headline">{p.subject}</p>
                  )}
                  <div className="mt-2">
                    <MessageBubble direction="out">
                      {p.body ?? "(template missing)"}
                    </MessageBubble>
                  </div>
                  {p.missing.length > 0 && (
                    <p className="text-footnote text-warning">
                      Empty here: {p.missing.join(", ")}
                    </p>
                  )}
                </section>
              ))}
            </>
          )}
        </div>
      </Sheet>

      <Sheet
        open={jsonOpen}
        onOpenChange={setJsonOpen}
        title="Raw JSON"
        detents={["large"]}
        trailing={
          <Button
            variant="plain"
            size="sm"
            className="font-semibold"
            onClick={async () => {
              const res = await saveAutomationJson({ id: a.id, json });
              if (res.ok) {
                toast({ title: "Saved", tone: "success" });
                setJsonOpen(false);
                router.refresh();
              } else
                toast({
                  title: "Not saved",
                  message: res.fieldErrors?.json?.join("\n") ?? res.error,
                  tone: "error",
                });
            }}
          >
            Save
          </Button>
        }
      >
        <div className="pb-8">
          <TextArea
            label="Automation JSON"
            hideLabel
            rows={22}
            className="font-mono text-footnote"
            value={json}
            onChange={(e) => setJson(e.currentTarget.value)}
          />
        </div>
      </Sheet>
      {dialog}
    </div>
  );
}
