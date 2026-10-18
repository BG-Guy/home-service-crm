"use client";

import { FlaskConical, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { Select, TextArea, TextField } from "@/ui/components/Field";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyField } from "@/ui/components/MoneyField";
import { MoneyText } from "@/ui/components/MoneyText";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Pill } from "@/ui/components/StatusPill";
import { toast } from "@/ui/components/Toast";
import {
  deleteSourceSpend,
  saveSourceMapping,
  saveSourceSpend,
  testSourcePayload,
} from "../actions";
import type { LeadPreviewResult } from "../contracts";
import type { Snippets } from "../snippets";
import { CopyBlock } from "./CopyBlock";

type Level = "plain" | "snippet" | "hosted" | "api";

/** §8.5 snippet generator: plain form, form + embed.js, hosted form, JSON API. */
export function SnippetTabs({
  snippets,
  initial,
  requireTs = false,
}: {
  snippets: Snippets;
  initial: Level;
  /** The source requires the signed `_ts` that embed.js / the hosted form add. */
  requireTs?: boolean;
}) {
  const levels: { value: Level; label: string }[] = [
    ...(snippets.plainForm ? [{ value: "plain" as const, label: "HTML" }] : []),
    ...(snippets.jsSnippet
      ? [{ value: "snippet" as const, label: "HTML + JS" }]
      : []),
    ...(snippets.hostedUrl
      ? [{ value: "hosted" as const, label: "Hosted" }]
      : []),
    { value: "api" as const, label: "API" },
  ];
  const [level, setLevel] = useState<Level>(
    levels.some((l) => l.value === initial)
      ? initial
      : (levels[0]?.value ?? "api"),
  );
  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        label="Integration level"
        segments={levels}
        value={level}
        onChange={setLevel}
      />
      {level === "plain" && snippets.plainForm && (
        <>
          {requireTs && (
            <Banner tone="warning" title="This source requires embed.js">
              “Require signed timestamp” is on, so leads from this plain form
              land under “Check” for review instead of the inbox. Use “HTML +
              JS”, or turn the timestamp off under Settings below.
            </Banner>
          )}
          <p className="px-1 text-subhead text-label-2">
            Paste into any page (GitHub Pages, Wix HTML block, WordPress “Custom
            HTML”). No JavaScript needed: after submit visitors land on your
            thank-you page. The consent box is unchecked and optional — keep it
            that way.
          </p>
          <CopyBlock code value={snippets.plainForm} label="HTML form" />
        </>
      )}
      {level === "snippet" && snippets.jsSnippet && (
        <>
          <p className="px-1 text-subhead text-label-2">
            Same form plus our 2 KB script: it adds ad attribution (UTM, gclid),
            a spam timestamp, the consent box if missing, and an inline
            “Thanks!” without leaving the page. Already have a form? Just add{" "}
            <code className="font-mono">data-crm-lead</code> to it and paste the
            script tag.
          </p>
          {snippets.scriptTag && (
            <CopyBlock code value={snippets.scriptTag} label="Script tag" />
          )}
          <CopyBlock code value={snippets.jsSnippet} label="Form + script" />
        </>
      )}
      {level === "hosted" && snippets.hostedUrl && (
        <>
          <p className="px-1 text-subhead text-label-2">
            For sites that can't run scripts or don't have a form: link a
            “Request service” button to this page, or embed it. Add{" "}
            <code className="font-mono">?utm_source=…</code> to track campaigns.
          </p>
          <CopyBlock value={snippets.hostedUrl} label="Form link" />
          {snippets.iframe && (
            <CopyBlock code value={snippets.iframe} label="Embed (iframe)" />
          )}
          <p className="px-1 text-footnote text-label-2">
            WordPress: add a “Custom HTML” block and paste the embed. Webflow:
            Add → Embed. Squarespace: Code block.
          </p>
          <Button
            variant="tinted"
            size="sm"
            href={snippets.hostedUrl}
            target="_blank"
            rel="noopener"
          >
            Open the form
          </Button>
        </>
      )}
      {level === "api" && (
        <>
          <p className="px-1 text-subhead text-label-2">
            Server-to-server, Zapier/Make “Webhooks” step or your own backend.
            Responses with the secret key: 201 created, 200 merged (same
            person/request), 400 with field errors, 429 slow down. With the site
            key every accepted lead returns 200 “received”.
          </p>
          <CopyBlock code value={snippets.curl} label="curl (secret key)" />
          {snippets.curlPublic && (
            <CopyBlock
              code
              value={snippets.curlPublic}
              label="Browser fetch (site key)"
            />
          )}
          {snippets.curlPublic && requireTs && (
            <p className="px-1 text-footnote text-label-2">
              With the site key, send the <code className="font-mono">_ts</code>{" "}
              from <code className="font-mono">GET</code> on the form endpoint,
              or leads go to “Check” for review.
            </p>
          )}
          <p className="px-1 text-footnote text-label-2">
            Accepted fields and aliases:{" "}
            <code className="font-mono">GET /api/v1/leads/schema</code>
          </p>
        </>
      )}
    </div>
  );
}

const TARGETS = [
  ["name", "Name"],
  ["first_name", "First name"],
  ["last_name", "Last name"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["address", "Address (one line)"],
  ["street", "Street"],
  ["city", "City"],
  ["state", "State"],
  ["zip", "ZIP"],
  ["service", "Service"],
  ["price", "Quoted price"],
  ["preferred_date", "Preferred date"],
  ["preferred_window", "Time window"],
  ["notes", "Notes"],
  ["external_id", "External id"],
  ["sms_consent", "SMS consent"],
] as const;

type MapRow = { target: string; path: string };

function PreviewResult({ r }: { r: LeadPreviewResult }) {
  const errs = Object.entries(r.errors);
  return (
    <div className="flex flex-col gap-2">
      {errs.length > 0 && (
        <Banner tone="warning" title="Would be rejected by the JSON API">
          {errs.map(([k, v]) => `${k}: ${v.join(", ")}`).join(" · ")}
        </Banner>
      )}
      {r.missingMappings.length > 0 && (
        <Banner tone="info" title="Mapped paths not found">
          {r.missingMappings.join(", ")}
        </Banner>
      )}
      <ListSection header="The lead would look like this">
        {r.fields.length === 0 && (
          <ListRow
            title={<span className="text-label-2">No fields recognized</span>}
          />
        )}
        {r.fields.map((f) => (
          <ListRow key={f.label} title={f.label} subtitle={f.value} multiline />
        ))}
        <ListRow
          title="Spam score"
          detail={
            <Pill tone={r.spamScore >= 50 ? "orange" : "green"} size="sm">
              {r.spamScore}
              {r.spamReasons.length ? ` · ${r.spamReasons.join(", ")}` : ""}
            </Pill>
          }
        />
        {r.extraKeys.length > 0 && (
          <ListRow
            title="Kept as extra"
            subtitle={r.extraKeys.join(", ")}
            multiline
          />
        )}
      </ListSection>
    </div>
  );
}

/** JSON-path mapping editor with "Test with last payload". */
export function MappingEditor({
  sourceId,
  initial,
  lastEventId,
}: {
  sourceId: string;
  initial: Record<string, string> | null;
  lastEventId: string | null;
}) {
  const [rows, setRows] = useState<MapRow[]>(
    Object.entries(initial ?? {}).map(([target, path]) => ({ target, path })),
  );
  const [result, setResult] = useState<LeadPreviewResult | null>(null);
  const [pending, start] = useTransition();
  const set = (i: number, patch: Partial<MapRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const test = () =>
    start(async () => {
      if (!lastEventId) return void toast.warning("No payload received yet");
      const r = await testSourcePayload({
        id: sourceId,
        eventId: lastEventId,
        mapping: rows,
      });
      if (!r.ok) return void toast.error(r.error);
      setResult(r.data);
    });
  const save = () =>
    start(async () => {
      const r = await saveSourceMapping({
        id: sourceId,
        mapping: rows.filter((x) => x.path.trim()),
      });
      if (r.ok) toast.success(`Mapping saved (${r.data?.count ?? 0} fields)`);
      else toast.error(r.error);
    });
  return (
    <div className="flex flex-col gap-3">
      <p className="px-1 text-subhead text-label-2">
        Only needed when a sender uses unusual field names. Map our field to a
        path in their JSON, e.g.{" "}
        <code className="font-mono">customer.displayName</code> or{" "}
        <code className="font-mono">answers[0].value</code>. Standard names
        (name, phone, email…) work without mapping.
      </p>
      {rows.map((r, i) => (
        <div
          key={`${i}-${r.target}`}
          className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_44px] items-end gap-2"
        >
          <Select
            label="Field"
            value={r.target}
            onChange={(e) => set(i, { target: e.currentTarget.value })}
            options={TARGETS.map(([value, label]) => ({ value, label }))}
          />
          <TextField
            label="JSON path"
            value={r.path}
            onChange={(e) => set(i, { path: e.currentTarget.value })}
            placeholder="data.customer.phone"
          />
          <button
            type="button"
            aria-label="Remove mapping"
            onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
            className="pressable mb-0.5 flex size-11 items-center justify-center rounded-full text-[var(--sys-red)] hover:bg-fill-2"
          >
            <Trash2 size={18} aria-hidden />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="gray"
          size="sm"
          icon={<Plus size={16} aria-hidden />}
          onClick={() => setRows((rs) => [...rs, { target: "name", path: "" }])}
        >
          Add field
        </Button>
        <Button
          variant="gray"
          size="sm"
          icon={<FlaskConical size={16} aria-hidden />}
          onClick={test}
          disabled={!lastEventId}
          loading={pending}
        >
          Test with last payload
        </Button>
        <Button variant="filled" size="sm" onClick={save} loading={pending}>
          Save mapping
        </Button>
      </div>
      {result && <PreviewResult r={result} />}
    </div>
  );
}

export interface PayloadRow {
  id: string;
  kind: string;
  outcome: string | null;
  leadId: string | null;
  at: string;
  ip: string | null;
  raw: string;
}

/** Last 20 payloads with the mapping result, plus a paste-a-payload box. */
export function TestConsole({
  sourceId,
  payloads,
  sample,
}: {
  sourceId: string;
  payloads: PayloadRow[];
  sample: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [result, setResult] = useState<{
    id: string;
    r: LeadPreviewResult;
  } | null>(null);
  const [paste, setPaste] = useState("");
  const [pending, start] = useTransition();
  const run = (id: string, input: { eventId?: string; payload?: string }) =>
    start(async () => {
      const r = await testSourcePayload({ id: sourceId, ...input });
      if (!r.ok) return void toast.error(r.error);
      setResult({ id, r: r.data });
    });
  return (
    <div className="flex flex-col gap-3">
      {payloads.length === 0 ? (
        <Banner tone="info" title="Nothing received yet">
          Submit your form once (or send the curl example). It shows up here
          within a second — that's how you know the site is connected.
        </Banner>
      ) : (
        <ListSection header={`Last ${payloads.length} payloads`}>
          {payloads.map((p) => (
            <div key={p.id}>
              <ListRow
                title={
                  p.kind === "spam"
                    ? `Spam · ${p.outcome ?? ""}`
                    : p.kind === "touch"
                      ? "Merged into an open lead"
                      : "Lead received"
                }
                subtitle={`${new Date(p.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${p.ip ? ` · ${p.ip}` : ""}`}
                accessory={openId === p.id ? "check" : "chevron"}
                onClick={() => setOpenId(openId === p.id ? null : p.id)}
              />
              {openId === p.id && (
                <div className="flex flex-col gap-2 px-4 pb-3">
                  <CopyBlock code value={p.raw} label="Raw payload" />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="gray"
                      size="sm"
                      onClick={() => run(p.id, { eventId: p.id })}
                      loading={pending}
                    >
                      Show mapping result
                    </Button>
                    {p.leadId && (
                      <Button
                        variant="plain"
                        size="sm"
                        href={`/leads/${p.leadId}`}
                      >
                        Open lead
                      </Button>
                    )}
                  </div>
                  {result?.id === p.id && <PreviewResult r={result.r} />}
                </div>
              )}
            </div>
          ))}
        </ListSection>
      )}
      <TextArea
        label="Try a payload"
        rows={6}
        value={paste}
        onChange={(e) => setPaste(e.currentTarget.value)}
        placeholder={sample}
        className="font-mono"
      />
      <div className="flex gap-2">
        <Button
          variant="gray"
          size="sm"
          icon={<FlaskConical size={16} aria-hidden />}
          loading={pending}
          onClick={() => run("paste", { payload: paste || sample })}
        >
          Preview (nothing is saved)
        </Button>
      </div>
      {result?.id === "paste" && <PreviewResult r={result.r} />}
    </div>
  );
}

/** Monthly spend for ROI (source_spend). */
export function SpendEditor({
  sourceId,
  rows,
}: {
  sourceId: string;
  rows: {
    id: string;
    month: string;
    amountCents: number;
    notes: string | null;
  }[];
}) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const thisMonth = new Date().toISOString().slice(0, 7);
  const submit = (fd: FormData) =>
    start(async () => {
      fd.set("id", sourceId);
      const r = await saveSourceSpend(fd);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return void toast.error(r.error);
      }
      setErrors({});
      toast.success("Spend saved");
    });
  return (
    <div className="flex flex-col gap-3">
      {rows.length > 0 && (
        <ListSection>
          {rows.map((r) => (
            <ListRow
              key={r.id}
              title={new Date(`${r.month}T12:00:00Z`).toLocaleDateString(
                "en-US",
                {
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                },
              )}
              subtitle={r.notes ?? undefined}
              detail={<MoneyText cents={r.amountCents} />}
              accessory={
                <button
                  type="button"
                  aria-label="Delete this month"
                  className="pressable flex size-11 items-center justify-center rounded-full text-label-2 hover:bg-fill-2"
                  onClick={() =>
                    start(async () => {
                      const d = await deleteSourceSpend({
                        id: sourceId,
                        spendId: r.id,
                      });
                      if (!d.ok) toast.error(d.error);
                    })
                  }
                >
                  <Trash2 size={17} aria-hidden />
                </button>
              }
            />
          ))}
        </ListSection>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(new FormData(e.currentTarget));
        }}
        className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-end gap-2"
      >
        <TextField
          label="Month"
          name="month"
          type="month"
          defaultValue={thisMonth}
          error={errors.month}
        />
        <MoneyField
          label="Spend"
          name="amount"
          placeholder="0.00"
          error={errors.amount}
        />
        <TextField
          label="Note"
          name="notes"
          className="col-span-2"
          placeholder="Optional"
        />
        <Button
          type="submit"
          variant="tinted"
          size="md"
          className="col-span-2"
          loading={pending}
        >
          Save month
        </Button>
      </form>
    </div>
  );
}
