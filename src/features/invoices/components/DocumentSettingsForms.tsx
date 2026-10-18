"use client";

import { type FormEvent, useState, useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { Select, TextArea, TextField } from "@/ui/components/Field";
import { ListGroup, ListSection } from "@/ui/components/List";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import {
  publishDocumentPolicy,
  saveCounters,
  saveDocumentSettings,
} from "../settings-actions";

// Client forms of Settings → Invoices & estimates. Each section saves on its own;
// field errors from the server are shown inline.

type Errors = Record<string, string[]>;
type Res = { ok: true } | { ok: false; error: string; fieldErrors?: Errors };

function useSubmit(
  fn: (fd: FormData) => Promise<Res>,
  success: string,
): [boolean, Errors, (e: FormEvent<HTMLFormElement>) => void] {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Errors>({});
  return [
    pending,
    errors,
    (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      start(async () => {
        const r = await fn(fd);
        if (r.ok) {
          setErrors({});
          toast({ title: success, tone: "success" });
        } else {
          setErrors(r.fieldErrors ?? {});
          toast({ title: r.error, tone: "error" });
        }
      });
    },
  ];
}

const TERMS = [
  { value: "due_on_receipt", label: "Due on receipt" },
  { value: "net_15", label: "Net 15" },
  { value: "net_30", label: "Net 30" },
];

export interface DocSettingsValues {
  invoices: {
    auto_issue_on_complete: boolean;
    photos_on_invoice: boolean;
    photos_on_receipt: boolean;
    residential_terms: string;
    commercial_terms: string;
    footer: string;
    late_fee: { enabled: boolean; pct_bps: number };
  };
  estimates: {
    expiry_days: number;
    change_order_threshold_pct: number;
    change_order_threshold_cents: number;
    option_labels: string[];
  };
  portal: { show_tech_photo: boolean; allow_reschedule_request: boolean };
  discount: { admin: number; office: number; tech: number };
}

export function DocumentSettingsForm({ v }: { v: DocSettingsValues }) {
  const [pending, errors, onSubmit] = useSubmit(
    saveDocumentSettings as (fd: FormData) => Promise<Res>,
    "Settings saved",
  );
  const err = (k: string) => errors[k]?.[0];
  const labels = [0, 1, 2].map((i) => v.estimates.option_labels[i] ?? "");
  return (
    <form onSubmit={onSubmit}>
      <ListGroup>
        <ListSection
          header="Invoices"
          footer="Residential customers get the first terms; commercial, property-manager and warranty customers the second."
        >
          <ToggleRow
            title="Issue the invoice when a job is completed"
            name="invoices.auto_issue_on_complete"
            defaultChecked={v.invoices.auto_issue_on_complete}
          />
          <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
            <Select
              label="Residential terms"
              name="invoices.residential_terms"
              defaultValue={v.invoices.residential_terms}
              options={TERMS}
            />
            <Select
              label="Commercial terms"
              name="invoices.commercial_terms"
              defaultValue={v.invoices.commercial_terms}
              options={TERMS}
            />
          </div>
          <div className="px-4 py-3">
            <TextArea
              label="Invoice footer"
              name="invoices.footer"
              defaultValue={v.invoices.footer}
              rows={2}
              placeholder="Thank you for your business!"
              error={err("invoices.footer")}
            />
          </div>
        </ListSection>

        <ListSection
          header="Late fee"
          footer="Mentioned in the final reminder only when enabled. Check your state's limits before turning it on."
        >
          <ToggleRow
            title="Charge a late fee"
            name="invoices.late_fee.enabled"
            defaultChecked={v.invoices.late_fee.enabled}
          />
          <div className="px-4 py-3">
            <TextField
              label="Late fee (% per month)"
              name="invoices.late_fee.pct"
              type="number"
              step="0.01"
              min={0}
              max={25}
              defaultValue={String(v.invoices.late_fee.pct_bps / 100)}
              error={err("invoices.late_fee.pct")}
            />
          </div>
        </ListSection>

        <ListSection header="Photos">
          <ToggleRow
            title="Before/after photos on invoices"
            subtitle="Up to 8, 2-up, with captions"
            name="invoices.photos_on_invoice"
            defaultChecked={v.invoices.photos_on_invoice}
          />
          <ToggleRow
            title="Photo strip on receipts"
            name="invoices.photos_on_receipt"
            defaultChecked={v.invoices.photos_on_receipt}
          />
        </ListSection>

        <ListSection
          header="Estimates"
          footer="A change order is required when the job total grows past the signed estimate by more than the percentage or the dollar amount (0 = off)."
        >
          <div className="grid gap-3 px-4 py-3 sm:grid-cols-3">
            {labels.map((l, i) => (
              <TextField
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed three slots
                key={i}
                label={`Option ${i + 1} label`}
                name="estimates.option_labels[]"
                defaultValue={l}
                placeholder={["Good", "Better", "Best"][i]}
                error={i === 0 ? err("estimates.option_labels") : undefined}
              />
            ))}
          </div>
          <div className="grid gap-3 px-4 py-3 sm:grid-cols-3">
            <TextField
              label="Expires after (days)"
              name="estimates.expiry_days"
              type="number"
              min={1}
              max={365}
              defaultValue={String(v.estimates.expiry_days)}
              error={err("estimates.expiry_days")}
            />
            <TextField
              label="Change order over (%)"
              name="estimates.change_order_threshold_pct"
              type="number"
              step="0.1"
              min={0}
              max={100}
              defaultValue={String(v.estimates.change_order_threshold_pct)}
              error={err("estimates.change_order_threshold_pct")}
            />
            <TextField
              label="…or over ($)"
              name="estimates.change_order_threshold_dollars"
              type="number"
              step="1"
              min={0}
              defaultValue={String(
                v.estimates.change_order_threshold_cents / 100,
              )}
              error={err("estimates.change_order_threshold_dollars")}
            />
          </div>
        </ListSection>

        <ListSection
          header="Discount limits"
          footer="The largest discount each role may give on an estimate or invoice, as a share of the price. Higher needs an admin."
        >
          <div className="grid grid-cols-3 gap-3 px-4 py-3">
            {(["admin", "office", "tech"] as const).map((r) => (
              <TextField
                key={r}
                label={`${r[0]?.toUpperCase()}${r.slice(1)} (%)`}
                name={`discount.${r}`}
                type="number"
                min={0}
                max={100}
                defaultValue={String(v.discount[r])}
                error={err(`discount.${r}`)}
              />
            ))}
          </div>
        </ListSection>

        <ListSection header="Customer pages">
          <ToggleRow
            title="Show the technician's photo"
            subtitle="On the job page customers open from texts"
            name="portal.show_tech_photo"
            defaultChecked={v.portal.show_tech_photo}
          />
          <ToggleRow
            title="Allow reschedule requests"
            name="portal.allow_reschedule_request"
            defaultChecked={v.portal.allow_reschedule_request}
          />
        </ListSection>

        <div className="flex justify-end">
          <Button type="submit" loading={pending}>
            Save settings
          </Button>
        </div>
      </ListGroup>
    </form>
  );
}

const COUNTER_LABEL = {
  invoice: "Invoices",
  estimate: "Estimates",
  change_order: "Change orders",
  credit_note: "Credit notes",
} as const;

export function CountersForm({
  counters,
}: {
  counters: Record<
    keyof typeof COUNTER_LABEL,
    { prefix: string; next: number }
  >;
}) {
  const [pending, errors, onSubmit] = useSubmit(
    saveCounters as (fd: FormData) => Promise<Res>,
    "Numbering saved",
  );
  return (
    <form onSubmit={onSubmit}>
      <ListSection
        header="Numbering"
        footer="Numbers are sequential and never reused; the next number can only move forward."
      >
        {(Object.keys(COUNTER_LABEL) as (keyof typeof COUNTER_LABEL)[]).map(
          (k) => (
            <div key={k} className="grid grid-cols-[1fr_1fr] gap-3 px-4 py-3">
              <TextField
                label={`${COUNTER_LABEL[k]} prefix`}
                name={`counters.${k}.prefix`}
                defaultValue={counters[k].prefix}
                maxLength={8}
                error={errors[`counters.${k}.prefix`]?.[0]}
              />
              <TextField
                label="Next number"
                name={`counters.${k}.next`}
                type="number"
                min={1}
                defaultValue={String(counters[k].next)}
                error={errors[`counters.${k}.next`]?.[0]}
              />
            </div>
          ),
        )}
      </ListSection>
      <div className="mt-2 flex justify-end">
        <Button type="submit" variant="tinted" loading={pending}>
          Save numbering
        </Button>
      </div>
    </form>
  );
}

export function PolicyForm({
  kind,
  label,
  title,
  body,
  version,
}: {
  kind: "warranty" | "esign_consent" | "cooling_off";
  label: string;
  title: string;
  body: string;
  version: number | null;
}) {
  const [pending, errors, onSubmit] = useSubmit(
    publishDocumentPolicy as (fd: FormData) => Promise<Res>,
    "New version published",
  );
  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="kind" value={kind} />
      <ListSection
        header={label}
        footer={
          version
            ? `Version ${version} is in force. Saving publishes a new version; signed documents keep the version they were signed under.`
            : "Not published yet."
        }
      >
        <div className="space-y-3 px-4 py-3">
          <TextField
            label="Title"
            name="title"
            defaultValue={title}
            error={errors.title?.[0]}
          />
          <TextArea
            label="Text"
            name="body"
            defaultValue={body}
            rows={6}
            error={errors.body?.[0]}
          />
        </div>
      </ListSection>
      <div className="mt-2 flex justify-end">
        <Button type="submit" variant="tinted" loading={pending}>
          Publish new version
        </Button>
      </div>
    </form>
  );
}
