"use client";

import { Info, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useDraft } from "@/client/drafts";
import { CustomerPicker } from "@/features/customers/slots.client";
import type { CustomFieldDef } from "@/features/settings/contracts";
import { CustomFieldsFields } from "@/features/settings/slots.client";
import { formatMoney } from "@/lib/money";
import { formatDateKey } from "@/lib/time";
import { Avatar } from "@/ui/components/Avatar";
import { Banner } from "@/ui/components/Banner";
import { BarSummary, BottomBar } from "@/ui/components/BottomBar";
import { Button } from "@/ui/components/Button";
import {
  DateField,
  Select,
  TextArea,
  TextField,
  TimeField,
} from "@/ui/components/Field";
import { ListSection } from "@/ui/components/List";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Stepper } from "@/ui/components/Stepper";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import { cx } from "@/ui/cx";
import { haptic } from "@/ui/motion/haptics";
import { createJobAction } from "../actions";
import { CALLBACK_REASON_LABEL } from "../machine";
import { newClientId } from "./offline-client";
import { splitFor } from "./split";

// /jobs/new (SPEC M05 create): S3 customer picker, service type, title, priority,
// window (1/2/4 h), assignees with split, after-hours, recurrence, callback-of,
// lead prefill, S56 custom fields. Autosaves a draft; idempotent on clientId.

export interface NewJobDefaults {
  customerId: string | null;
  propertyId: string | null;
  serviceTypeId: string | null;
  title: string;
  description: string;
  customerNotes: string;
  date: string;
  start: string;
  leadId: string | null;
  /** Price quoted on the lead (added to the invoice as the first line). */
  quotedPriceCents?: number | null;
  callbackOf: { id: string; number: string; title: string } | null;
}

type Draft = {
  customerId: string | null;
  propertyId: string | null;
  serviceTypeId: string;
  title: string;
  description: string;
  customerNotes: string;
  priority: "normal" | "urgent" | "emergency";
  afterHours: boolean;
  schedule: boolean;
  date: string;
  start: string;
  minutes: number;
  picks: { userId: string; role: "primary" | "helper" }[];
  primaryPct: number;
  repeat: boolean;
  every: "weeks" | "months";
  n: number;
  callbackReason: "workmanship" | "part" | "customer" | "other";
};

const fmtWindow = (m: number) =>
  m % 60 === 0 ? `${m / 60} h window` : `${m} min window`;

export function NewJobForm({
  defaults,
  serviceTypes,
  techs,
  canAssign,
  viewerId,
  windowLengths,
  defaultWindow,
  customFieldDefs,
  disclosure,
  cancellationSummary,
}: {
  defaults: NewJobDefaults;
  serviceTypes: { id: string; name: string; defaultDurationMin: number }[];
  techs: { id: string; name: string; clockedIn: boolean }[];
  canAssign: boolean;
  viewerId: string;
  windowLengths: number[];
  defaultWindow: number;
  customFieldDefs: CustomFieldDef[];
  disclosure: string | null;
  cancellationSummary: string | null;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const clientId = useRef(newClientId());
  const draftKey = `job:new:${defaults.leadId ?? defaults.callbackOf?.id ?? defaults.customerId ?? "blank"}`;
  const initial: Draft = {
    customerId: defaults.customerId,
    propertyId: defaults.propertyId,
    serviceTypeId: defaults.serviceTypeId ?? "",
    title: defaults.title,
    description: defaults.description,
    customerNotes: defaults.customerNotes,
    priority: "normal",
    afterHours: false,
    schedule: !!defaults.date,
    date: defaults.date,
    start: defaults.start,
    minutes: defaultWindow,
    picks: canAssign ? [] : [{ userId: viewerId, role: "primary" }],
    primaryPct: 50,
    repeat: false,
    every: "months",
    n: 12,
    callbackReason: "workmanship",
  };
  const [d, setD, clearDraft] = useDraft<Draft>(draftKey, initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setD({ ...d, [k]: v });
  const lengths = useMemo(
    () => [...new Set([...windowLengths, d.minutes])].sort((a, b) => a - b),
    [windowLengths, d.minutes],
  );
  const err = (k: string) => errors[k]?.[0];

  const pickService = (id: string) => {
    const st = serviceTypes.find((s) => s.id === id);
    setD({
      ...d,
      serviceTypeId: id,
      title:
        !d.title || serviceTypes.some((s) => s.name === d.title)
          ? (st?.name ?? d.title)
          : d.title,
      minutes: st && !d.schedule ? st.defaultDurationMin : d.minutes,
    });
  };

  const toggleTech = (id: string) => {
    haptic();
    const has = d.picks.some((p) => p.userId === id);
    const next = has
      ? d.picks.filter((p) => p.userId !== id)
      : [
          ...d.picks,
          {
            userId: id,
            role: d.picks.length ? ("helper" as const) : ("primary" as const),
          },
        ];
    if (next.length && !next.some((p) => p.role === "primary"))
      next[0] = { ...(next[0] as Draft["picks"][number]), role: "primary" };
    set("picks", next);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!d.customerId || !d.propertyId) {
      setErrors({ customerId: ["Pick a customer and service address."] });
      toast.error("Pick a customer and service address.");
      return;
    }
    const custom: Record<string, unknown> = {};
    if (formRef.current)
      for (const [k, v] of new FormData(formRef.current).entries()) {
        if (!k.startsWith("custom.") || typeof v !== "string") continue;
        const key = k.slice(7).replace(/\[\]$/, "");
        if (k.endsWith("[]"))
          custom[key] = [...((custom[key] as string[]) ?? []), v];
        else if (v !== "") custom[key] = v;
      }
    start(async () => {
      const r = await createJobAction({
        customerId: d.customerId as string,
        propertyId: d.propertyId as string,
        serviceTypeId: d.serviceTypeId || null,
        title: d.title,
        description: d.description || null,
        customerNotes: d.customerNotes || null,
        priority: d.priority,
        afterHours: d.afterHours,
        date: d.schedule ? d.date || null : null,
        start: d.schedule ? d.start || null : null,
        minutes: d.minutes,
        assignees: splitFor(d.picks, d.primaryPct),
        recurrence: d.repeat ? { every: d.every, n: d.n } : null,
        callbackOfJobId: defaults.callbackOf?.id ?? null,
        callbackReason: defaults.callbackOf ? d.callbackReason : null,
        leadId: defaults.leadId,
        custom,
        clientId: clientId.current,
      });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
        return;
      }
      haptic();
      clearDraft();
      toast.success(`Job ${r.data?.number ?? ""} created`, {
        message:
          r.data?.status === "scheduled"
            ? "Scheduled and assigned."
            : "It's in the unscheduled queue.",
      });
      router.replace(`/jobs/${r.data?.jobId}`);
    });
  };

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      className="flex flex-col gap-[var(--section-gap)]"
      noValidate
    >
      {defaults.callbackOf && (
        <Banner
          tone="info"
          title={`Callback for ${defaults.callbackOf.number}`}
        >
          {defaults.callbackOf.title}. Callbacks are no-charge by default and
          count against the original job's warranty.
        </Banner>
      )}

      {defaults.leadId && !!defaults.quotedPriceCents && (
        <Banner
          tone="info"
          title={`Quoted ${formatMoney(defaults.quotedPriceCents)}`}
        >
          The price quoted on the lead becomes the first line on this job's
          invoice. You can change it before the invoice goes out.
        </Banner>
      )}
      {/* The picker brings its own "Customer" section (no second header, QA T2-25). */}
      <div className="flex flex-col gap-1.5">
        <div>
          <CustomerPicker
            name="customer"
            defaultCustomerId={d.customerId ?? undefined}
            defaultPropertyId={d.propertyId ?? undefined}
            allowCreate
            requireProperty
            onChange={(v) => {
              if (
                v.customerId !== d.customerId ||
                v.propertyId !== d.propertyId
              )
                setD({
                  ...d,
                  customerId: v.customerId,
                  propertyId: v.propertyId,
                });
            }}
          />
        </div>
        {err("customerId") && (
          <p className="px-4 text-footnote text-danger" role="alert">
            {err("customerId")}
          </p>
        )}
      </div>

      <ListSection header="Job">
        <div className="flex flex-col gap-3 px-4 py-3">
          <Select
            label="Service type"
            value={d.serviceTypeId}
            placeholder="Choose a service"
            options={serviceTypes.map((s) => ({ value: s.id, label: s.name }))}
            onChange={(e) => pickService(e.target.value)}
          />
          <TextField
            label="Title"
            value={d.title}
            maxLength={200}
            required
            placeholder="e.g. Rekey front and back doors"
            error={err("title")}
            onChange={(e) => set("title", e.target.value)}
          />
          {defaults.callbackOf && (
            <Select
              label="Why the callback?"
              value={d.callbackReason}
              options={Object.entries(CALLBACK_REASON_LABEL).map(
                ([value, label]) => ({ value, label }),
              )}
              onChange={(e) =>
                set("callbackReason", e.target.value as Draft["callbackReason"])
              }
            />
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-footnote font-semibold text-label-2">
              Priority
            </span>
            <SegmentedControl
              label="Priority"
              value={d.priority}
              onChange={(v) => set("priority", v)}
              segments={[
                { value: "normal", label: "Normal" },
                { value: "urgent", label: "Urgent" },
                { value: "emergency", label: "Emergency" },
              ]}
            />
          </div>
          <TextArea
            label="Customer notes"
            hint="What the customer told us — the tech sees this."
            rows={2}
            maxLength={5000}
            value={d.customerNotes}
            onChange={(e) => set("customerNotes", e.target.value)}
          />
          <TextArea
            label="Internal description"
            rows={2}
            maxLength={5000}
            value={d.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>
        <ToggleRow
          title="After hours"
          subtitle="After-hours pricing and pay rules"
          checked={d.afterHours}
          onChange={(e) => set("afterHours", e.target.checked)}
        />
      </ListSection>

      <ListSection header="When">
        <ToggleRow
          title="Schedule now"
          subtitle={
            d.schedule
              ? undefined
              : "Leave off to put it in the unscheduled queue"
          }
          checked={d.schedule}
          onChange={(e) => set("schedule", e.target.checked)}
        />
        {d.schedule && (
          <div className="grid grid-cols-2 gap-3 px-4 py-3">
            <DateField
              label="Date"
              value={d.date}
              error={err("date")}
              onChange={(e) => set("date", e.target.value)}
            />
            <TimeField
              label="Arrive from"
              value={d.start}
              step={900}
              error={err("start")}
              onChange={(e) => set("start", e.target.value)}
            />
            <Select
              label="Arrival window"
              className="col-span-2"
              value={String(d.minutes)}
              options={lengths.map((m) => ({
                value: String(m),
                label: fmtWindow(m),
              }))}
              onChange={(e) => set("minutes", Number(e.target.value))}
            />
          </div>
        )}
        <ToggleRow
          title="Repeats"
          subtitle="Books the next visit when this one is completed"
          checked={d.repeat}
          onChange={(e) => set("repeat", e.target.checked)}
        />
        {d.repeat && (
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-body">Every</span>
            <div className="flex items-center gap-2">
              <Stepper
                label="Repeat every"
                value={d.n}
                min={1}
                max={24}
                onChange={(n) => set("n", n)}
              />
              <Select
                label="Unit"
                hideLabel
                value={d.every}
                options={[
                  { value: "weeks", label: d.n === 1 ? "week" : "weeks" },
                  { value: "months", label: d.n === 1 ? "month" : "months" },
                ]}
                onChange={(e) => set("every", e.target.value as Draft["every"])}
              />
            </div>
          </div>
        )}
      </ListSection>

      {canAssign && (
        <ListSection
          header="Technicians"
          footer={
            d.picks.length > 1
              ? `Split: ${splitFor(d.picks, d.primaryPct)
                  .map(
                    (a) =>
                      `${techs.find((t) => t.id === a.userId)?.name.split(" ")[0]} ${a.splitBps / 100}%`,
                  )
                  .join(" · ")}`
              : "A job is scheduled once it has a time and a technician."
          }
        >
          {techs.length === 0 && (
            <p className="px-4 py-3 text-subhead text-label-2">
              No active technicians yet.
            </p>
          )}
          {techs.map((t) => {
            const pick = d.picks.find((p) => p.userId === t.id);
            return (
              <div
                key={t.id}
                className="list-row flex min-h-[52px] items-center gap-3 pl-4 pr-2"
              >
                <button
                  type="button"
                  aria-pressed={!!pick}
                  onClick={() => toggleTech(t.id)}
                  className="row-press flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
                >
                  <Avatar
                    name={t.name}
                    seed={t.id}
                    size={32}
                    status={t.clockedIn ? "online" : undefined}
                  />
                  <span className="flex-1 truncate text-body">{t.name}</span>
                  <span
                    aria-hidden
                    className={cx(
                      "flex size-6 items-center justify-center rounded-full border-[1.5px] transition-colors",
                      pick
                        ? "border-transparent bg-accent-fill text-on-accent"
                        : "border-label-3",
                    )}
                  >
                    {pick && (
                      <svg
                        viewBox="0 0 12 12"
                        className="size-3"
                        aria-hidden="true"
                      >
                        <path
                          d="M2.5 6.2 5 8.5l4.5-5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                </button>
                {pick && d.picks.length > 1 && (
                  <button
                    type="button"
                    aria-pressed={pick.role === "primary"}
                    aria-label={`Make ${t.name} primary`}
                    onClick={() =>
                      set(
                        "picks",
                        d.picks.map((p) => ({
                          ...p,
                          role: p.userId === t.id ? "primary" : "helper",
                        })),
                      )
                    }
                    className="flex size-11 items-center justify-center rounded-full"
                  >
                    <Star
                      size={18}
                      className={
                        pick.role === "primary"
                          ? "fill-[var(--sys-yellow)] text-[var(--sys-yellow)]"
                          : "text-label-3"
                      }
                    />
                  </button>
                )}
              </div>
            );
          })}
          {d.picks.length > 1 && (
            <div className="list-row flex min-h-11 items-center justify-between px-4 py-2">
              <span className="text-body">Primary share</span>
              <Stepper
                label="Primary share"
                value={d.primaryPct}
                min={10}
                max={90}
                step={5}
                format={(n) => `${n}%`}
                onChange={(n) => set("primaryPct", n)}
              />
            </div>
          )}
        </ListSection>
      )}

      {customFieldDefs.length > 0 && (
        <ListSection header="More info">
          <div className="px-4 py-3">
            <CustomFieldsFields
              defs={customFieldDefs}
              values={{}}
              errors={Object.fromEntries(
                Object.entries(errors)
                  .filter(([k]) => k.startsWith("custom."))
                  .map(([k, v]) => [k.slice(7), v]),
              )}
            />
          </div>
        </ListSection>
      )}

      {(disclosure || cancellationSummary) && (
        <p className="flex gap-2 px-1 text-footnote text-label-2">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {[disclosure, cancellationSummary].filter(Boolean).join(" ")} Saved
            with the job when it's booked.
          </span>
        </p>
      )}

      {/* The booking bar (DESIGN.md §5): sticky, never covers the last field. */}
      <BottomBar
        label="Create job"
        summary={
          <BarSummary
            title={d.title.trim() || "New job"}
            subtitle={
              d.schedule && d.date
                ? `${formatDateKey(d.date, "en-US", { weekday: "short", month: "short", day: "numeric" })}${d.start ? ` · ${d.start}` : ""}${d.picks.length ? ` · ${d.picks.length} tech${d.picks.length === 1 ? "" : "s"}` : " · no tech yet"}`
                : "Not scheduled yet"
            }
          />
        }
        action={
          <Button
            type="submit"
            size="lg"
            loading={pending}
            disabled={!d.title.trim()}
          >
            {d.schedule && d.date && d.picks.length ? "Book job" : "Create job"}
          </Button>
        }
      />
    </form>
  );
}
