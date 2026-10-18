"use client";

import { Plus, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { Select, TextArea, TextField } from "@/ui/components/Field";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyField } from "@/ui/components/MoneyField";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import {
  createLeadSource,
  rotateSourceKey,
  saveLeadSettings,
  updateLeadSource,
} from "../actions";
import type { IntegrationKind, IssuedSecrets } from "../contracts";
import {
  INTEGRATION_HINT,
  INTEGRATION_LABEL,
  lostReasonLabel,
  PRESET_LABEL,
  SOURCE_KIND_LABEL,
} from "../labels";
import { SecretsReveal } from "./SecretsReveal";

const KIND_OPTIONS = Object.entries(SOURCE_KIND_LABEL).map(
  ([value, label]) => ({
    value,
    label,
  }),
);
const PRESET_OPTIONS = Object.entries(PRESET_LABEL).map(([value, label]) => ({
  value,
  label,
}));
const INTEGRATIONS = Object.keys(INTEGRATION_LABEL) as IntegrationKind[];

function useFieldErrors() {
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  return [errors, setErrors] as const;
}

/** "Add source" sheet: pick how leads arrive; keys are issued and shown once. */
export function NewSourceButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [integration, setIntegration] = useState<IntegrationKind>("js_snippet");
  const [created, setCreated] = useState<{
    id: string;
    secrets: IssuedSecrets;
  } | null>(null);
  const [errors, setErrors] = useFieldErrors();
  const [pending, start] = useTransition();
  const formId = "new-lead-source";

  const submit = (fd: FormData) =>
    start(async () => {
      fd.set("integrationKind", integration);
      const r = await createLeadSource(fd);
      if (!r.ok || !r.data) {
        setErrors(r.ok ? {} : (r.fieldErrors ?? {}));
        return void toast.error(r.ok ? "Couldn't create" : r.error);
      }
      setCreated(r.data);
      toast.success("Source created");
    });

  return (
    <>
      <Button
        variant="tinted"
        size="md"
        icon={<Plus size={18} aria-hidden />}
        onClick={() => setOpen(true)}
      >
        Add source
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={created ? "Source ready" : "New lead source"}
        detents={["large"]}
        onClosed={() => {
          setCreated(null);
          setErrors({});
        }}
        leading={
          <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
            {created ? "Close" : "Cancel"}
          </Button>
        }
        trailing={
          created ? (
            <Button
              variant="plain"
              size="sm"
              className="font-semibold"
              onClick={() => {
                setOpen(false);
                router.push(`/settings/lead-sources/${created.id}`);
              }}
            >
              Get snippet
            </Button>
          ) : (
            <Button
              variant="plain"
              size="sm"
              className="font-semibold"
              type="submit"
              form={formId}
              loading={pending}
            >
              Create
            </Button>
          )
        }
      >
        {created ? (
          <div className="flex flex-col gap-4 pb-6">
            <SecretsReveal secrets={created.secrets} />
            <p className="px-1 text-subhead text-label-2">
              Next: open the source to copy the ready-made form, script or API
              example.
            </p>
          </div>
        ) : (
          <form
            id={formId}
            onSubmit={(e) => {
              e.preventDefault();
              submit(new FormData(e.currentTarget));
            }}
            className="flex flex-col gap-[var(--section-gap)] pb-6"
          >
            <div className="flex flex-col gap-3">
              <TextField
                label="Name"
                name="name"
                placeholder="Website, Thumbtack, Yard signs…"
                required
                error={errors.name}
              />
              <Select
                label="Type"
                name="kind"
                defaultValue="website"
                options={KIND_OPTIONS}
              />
            </div>
            <ListSection header="How do leads arrive?">
              {INTEGRATIONS.map((k) => (
                <ListRow
                  key={k}
                  title={INTEGRATION_LABEL[k]}
                  subtitle={INTEGRATION_HINT[k]}
                  multiline
                  accessory={integration === k ? "check" : "none"}
                  onClick={() => setIntegration(k)}
                />
              ))}
            </ListSection>
            {integration === "preset" && (
              <Select
                label="Service"
                name="preset"
                defaultValue="thumbtack"
                options={PRESET_OPTIONS}
              />
            )}
            {integration !== "preset" && integration !== "json_api" && (
              <TextArea
                label="Your website domains"
                name="allowedOrigins"
                rows={2}
                placeholder="acme-locks.com"
                hint="One per line. Forms from other sites are treated as spam. Leave empty to accept any site (not recommended)."
                error={errors.allowedOrigins ?? errors["allowedOrigins.0"]}
              />
            )}
          </form>
        )}
      </Sheet>
    </>
  );
}

export interface SourceEditable {
  id: string;
  name: string;
  kind: string;
  integrationKind: IntegrationKind;
  preset: string;
  allowedOrigins: string[];
  requireTs: boolean;
  turnstileRequired: boolean;
  dailyCap: number;
  costModel: "none" | "per_lead" | "monthly";
  defaultCostCents: number | null;
  active: boolean;
}

/** Source settings (origins, `_ts`, Turnstile, cap, cost model, active). */
export function SourceSettingsForm({
  source,
  turnstileConfigured,
}: {
  source: SourceEditable;
  turnstileConfigured: boolean;
}) {
  const [integration, setIntegration] = useState(source.integrationKind);
  const [costModel, setCostModel] = useState(source.costModel);
  const [secrets, setSecrets] = useState<IssuedSecrets | null>(null);
  const [errors, setErrors] = useFieldErrors();
  const [pending, start] = useTransition();

  const submit = (fd: FormData) =>
    start(async () => {
      fd.set("id", source.id);
      fd.set("integrationKind", integration);
      fd.set("costModel", costModel);
      const cents = fd.get("defaultCostCents");
      fd.delete("defaultCostCents");
      if (cents) fd.set("defaultCost", (Number(cents) / 100).toFixed(2));
      const r = await updateLeadSource(fd);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return void toast.error(r.error);
      }
      setErrors({});
      const s = r.data?.secrets;
      if (s && Object.values(s).some(Boolean)) setSecrets(s);
      toast.success("Source saved");
    });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(new FormData(e.currentTarget));
      }}
      className="flex flex-col gap-[var(--section-gap)]"
    >
      {secrets && <SecretsReveal secrets={secrets} />}
      <div className="flex flex-col gap-3">
        <TextField
          label="Name"
          name="name"
          defaultValue={source.name}
          error={errors.name}
          required
        />
        <Select
          label="Type"
          name="kind"
          defaultValue={source.kind}
          options={KIND_OPTIONS}
        />
        <Select
          label="Integration"
          name="integration"
          value={integration}
          onChange={(e) =>
            setIntegration(e.currentTarget.value as IntegrationKind)
          }
          options={INTEGRATIONS.map((k) => ({
            value: k,
            label: INTEGRATION_LABEL[k] as string,
          }))}
          hint={INTEGRATION_HINT[integration]}
        />
        {integration === "preset" && (
          <Select
            label="Preset"
            name="preset"
            defaultValue={source.preset}
            options={PRESET_OPTIONS}
          />
        )}
        <TextArea
          label="Allowed website domains"
          name="allowedOrigins"
          rows={3}
          defaultValue={source.allowedOrigins.join("\n")}
          hint="One per line (example.com also allows www.example.com; *.example.com allows subdomains). Empty = any site."
          error={errors.allowedOrigins ?? errors["allowedOrigins.0"]}
        />
      </div>
      <ListSection
        header="Spam protection"
        footer={
          integration === "plain_form"
            ? "Plain HTML forms can't sign a timestamp, so leave “Require signed timestamp” off (with it on, their leads wait under “Check”). The honeypot, rate limits and spam score still apply."
            : "Doubtful leads land under “Check” in the inbox instead of being dropped."
        }
      >
        <ToggleRow
          title="Require signed timestamp"
          subtitle="embed.js and the hosted form add it. Instant bot posts are dropped; posts without it go to “Check”."
          name="requireTs"
          defaultChecked={source.requireTs}
        />
        <ToggleRow
          title="Require Cloudflare Turnstile"
          subtitle={
            turnstileConfigured
              ? "Invisible challenge on the form"
              : "Add TURNSTILE_SITE_KEY and TURNSTILE_SECRET first"
          }
          name="turnstileRequired"
          defaultChecked={source.turnstileRequired}
        />
        <ToggleRow
          title="Active"
          subtitle="Off = this key stops accepting leads"
          name="active"
          defaultChecked={source.active}
        />
      </ListSection>
      <div className="flex flex-col gap-3">
        <TextField
          label="Daily cap"
          name="dailyCap"
          type="number"
          inputMode="numeric"
          min={1}
          defaultValue={String(source.dailyCap)}
          hint="Max leads per day from this key (abuse guard)."
          error={errors.dailyCap}
        />
        <SegmentedControl
          label="Cost model"
          segments={[
            { value: "none", label: "Free" },
            { value: "per_lead", label: "Per lead" },
            { value: "monthly", label: "Monthly" },
          ]}
          value={costModel}
          onChange={setCostModel}
        />
        {costModel === "per_lead" && (
          <MoneyField
            label="Default cost per lead"
            name="defaultCostCents"
            defaultCents={source.defaultCostCents}
            hint="Used when the payload has no price (Thumbtack's leadPrice wins)."
            error={errors.defaultCost}
          />
        )}
      </div>
      <Button
        type="submit"
        variant="filled"
        size="lg"
        fullWidth
        loading={pending}
      >
        Save source
      </Button>
    </form>
  );
}

/** Rotate a key: confirm, then show the new value once. */
export function RotateKeyButton({
  sourceId,
  which,
  label,
}: {
  sourceId: string;
  which: "public" | "secret" | "hook" | "google";
  label: string;
}) {
  const [confirm, confirmEl] = useConfirm();
  const [secrets, setSecrets] = useState<IssuedSecrets | null>(null);
  const [pending, start] = useTransition();
  const rotate = async () => {
    const ok = await confirm({
      title: `${label}?`,
      message:
        which === "public"
          ? "Forms and snippets using the current site key stop working until you update them."
          : "The current key stops working immediately. Update every integration that uses it.",
      confirmLabel: "Rotate",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const r = await rotateSourceKey({ id: sourceId, which });
      if (!r.ok) return void toast.error(r.error);
      setSecrets(r.data?.secrets ?? null);
      toast.success("New key issued");
    });
  };
  return (
    <>
      {confirmEl}
      <ListRow
        icon={<RefreshCw size={17} />}
        iconTone="orange"
        title={label}
        onClick={rotate}
        disabled={pending}
        accessory="none"
      />
      <Sheet
        open={!!secrets}
        onOpenChange={(o) => !o && setSecrets(null)}
        title="New key"
        detents={["content"]}
        trailing={
          <Button
            variant="plain"
            size="sm"
            className="font-semibold"
            onClick={() => setSecrets(null)}
          >
            Done
          </Button>
        }
      >
        <div className="pb-6">
          {secrets && <SecretsReveal secrets={secrets} />}
        </div>
      </Sheet>
    </>
  );
}

/** settings.leads + company.lead_response_minutes (SPEC M04 / BUILD_PLAN §9). */
export function LeadSettingsForm({
  initial,
  sources,
}: {
  initial: {
    assignment: "first_to_claim" | "round_robin";
    slaBusinessHours: boolean;
    spamReviewThreshold: number;
    leadResponseMinutes: number;
    lostReasons: string[];
    defaultSourceId: string | null;
  };
  sources: { id: string; name: string }[];
}) {
  const [assignment, setAssignment] = useState(initial.assignment);
  const [errors, setErrors] = useFieldErrors();
  const [pending, start] = useTransition();
  const submit = (fd: FormData) =>
    start(async () => {
      fd.set("assignment", assignment);
      const r = await saveLeadSettings(fd);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return void toast.error(r.error);
      }
      setErrors({});
      toast.success("Lead settings saved");
    });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(new FormData(e.currentTarget));
      }}
      className="flex flex-col gap-[var(--section-gap)]"
    >
      <div className="flex flex-col gap-3">
        <SegmentedControl
          label="Assignment"
          segments={[
            { value: "first_to_claim", label: "First to claim" },
            { value: "round_robin", label: "Round-robin" },
          ]}
          value={assignment}
          onChange={setAssignment}
        />
        <TextField
          label="Promise to call back within (minutes)"
          name="leadResponseMinutes"
          type="number"
          inputMode="numeric"
          min={1}
          max={1440}
          defaultValue={String(initial.leadResponseMinutes)}
          hint="Used in the instant reply: “we'll call you within N min”."
          error={errors.leadResponseMinutes}
        />
        <TextField
          label="Spam review threshold (0–100)"
          name="spamReviewThreshold"
          type="number"
          inputMode="numeric"
          min={10}
          max={100}
          defaultValue={String(initial.spamReviewThreshold)}
          hint="Leads scoring at or above this go to “Check” instead of the inbox."
          error={errors.spamReviewThreshold}
        />
        <Select
          label="Default source for API keys"
          name="defaultSourceId"
          defaultValue={initial.defaultSourceId ?? ""}
          options={[
            { value: "", label: "None" },
            ...sources.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <TextArea
          label="Lost reasons"
          name="lostReasons"
          rows={5}
          defaultValue={initial.lostReasons.map(lostReasonLabel).join("\n")}
          hint="One per line."
          error={errors.lostReasons}
        />
      </div>
      <ListSection>
        <ToggleRow
          title="SLA counts business hours only"
          subtitle="Overnight leads don't breach the 5/15-minute timer before you open"
          name="slaBusinessHours"
          defaultChecked={initial.slaBusinessHours}
        />
      </ListSection>
      <Button
        type="submit"
        variant="filled"
        size="lg"
        fullWidth
        loading={pending}
      >
        Save lead settings
      </Button>
    </form>
  );
}
