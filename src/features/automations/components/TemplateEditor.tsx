"use client";

import { AlertTriangle, RotateCcw, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { channelLabel } from "@/features/messaging/labels";
import { toGsmSafe } from "@/features/messaging/lint";
import { useConfirm } from "@/ui/components/Alert";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { TextArea, TextField } from "@/ui/components/Field";
import { ListSection } from "@/ui/components/List";
import { MessageBubble } from "@/ui/components/MessageBubble";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import { previewTemplate, resetTemplate, saveTemplate } from "../actions";
import { VARIABLE_GROUPS } from "../variables";

export interface TemplateRowDTO {
  id: string;
  key: string;
  channel: string;
  purpose: string;
  subject: string | null;
  body: string;
  defaultBody: string;
  expiresAfterMinutes: number | null;
  allowOutsideQuietHours: boolean;
}

type Preview = Awaited<ReturnType<typeof previewTemplate>>;

/** One template key, every channel: variable picker, live preview, lint, reset. */
export function TemplateEditor({
  rows,
  isAdmin,
}: {
  rows: TemplateRowDTO[];
  isAdmin: boolean;
}) {
  const [channelId, setChannelId] = useState(rows[0]?.id ?? "");
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {rows.length > 1 && (
        <SegmentedControl
          label="Channel"
          value={channelId}
          segments={rows.map((r) => ({
            value: r.id,
            label: channelLabel(r.channel),
          }))}
          onChange={setChannelId}
        />
      )}
      {rows.map((r) =>
        r.id === channelId ? (
          <ChannelEditor key={r.id} row={r} isAdmin={isAdmin} />
        ) : null,
      )}
    </div>
  );
}

function ChannelEditor({
  row,
  isAdmin,
}: {
  row: TemplateRowDTO;
  isAdmin: boolean;
}) {
  const [body, setBody] = useState(row.body);
  const [subject, setSubject] = useState(row.subject ?? "");
  const [expires, setExpires] = useState(
    row.expiresAfterMinutes ? String(row.expiresAfterMinutes) : "",
  );
  const [outside, setOutside] = useState(row.allowOutsideQuietHours);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const area = useRef<HTMLTextAreaElement>(null);
  const [confirm, dialog] = useConfirm();
  const isText = row.channel === "sms" || row.channel === "whatsapp";
  const hasSubject =
    row.channel === "email" ||
    row.channel === "push" ||
    row.channel === "in_app";
  const staff = row.purpose === "internal";
  const dirty =
    body !== row.body ||
    subject !== (row.subject ?? "") ||
    expires !==
      (row.expiresAfterMinutes ? String(row.expiresAfterMinutes) : "") ||
    outside !== row.allowOutsideQuietHours;

  // Live preview + lint (debounced).
  useEffect(() => {
    const t = setTimeout(async () => {
      const res = await previewTemplate({
        key: row.key,
        channel: row.channel,
        purpose: row.purpose,
        body,
        subject: hasSubject ? subject : null,
      });
      if (res.ok && res.data) setPreview(res);
    }, 400);
    return () => clearTimeout(t);
  }, [body, subject, row.key, row.channel, row.purpose, hasSubject]);

  const insert = (path: string) => {
    const el = area.current;
    const token = `{{${path}}}`;
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async () => {
    setSaving(true);
    const res = await saveTemplate({
      id: row.id,
      subject: hasSubject ? subject : undefined,
      body,
      expiresAfterMinutes: expires ? Number(expires) : null,
      allowOutsideQuietHours: isAdmin ? outside : undefined,
    });
    setSaving(false);
    if (res.ok) {
      setErrors([]);
      toast({ title: "Template saved", tone: "success" });
    } else {
      setErrors(res.fieldErrors?.body ?? [res.error]);
      toast({ title: "Not saved", message: res.error, tone: "error" });
    }
  };

  const reset = async () => {
    const ok = await confirm({
      title: "Reset to the default text?",
      message:
        "Your edits to this channel are replaced by the original wording.",
      confirmLabel: "Reset",
      destructive: true,
    });
    if (!ok) return;
    const res = await resetTemplate({ id: row.id });
    if (res.ok && res.data) {
      setBody(res.data.body);
      toast({ title: "Back to the default text" });
    }
  };

  const data = preview?.ok ? preview.data : null;
  const lint = data?.lint;
  const gsm = lint?.gsm;

  return (
    <>
      {hasSubject && (
        <TextField
          label={row.channel === "email" ? "Subject" : "Title"}
          value={subject}
          onChange={(e) => setSubject(e.currentTarget.value)}
        />
      )}
      <div>
        <TextArea
          ref={area}
          label="Message"
          value={body}
          rows={6}
          className="font-mono"
          onChange={(e) => setBody(e.currentTarget.value)}
          error={errors.length ? errors : null}
        />
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 px-1 text-caption text-label-2">
          <span>
            {body.length} chars
            {gsm
              ? ` · ${gsm.segments} segment${gsm.segments === 1 ? "" : "s"} · ${gsm.encoding}`
              : ""}
          </span>
          {gsm && gsm.fixable.length > 0 && (
            <Button
              variant="plain"
              size="sm"
              icon={<Wand2 aria-hidden size={14} />}
              onClick={() => setBody(toGsmSafe(body))}
            >
              Fix curly quotes and dashes
            </Button>
          )}
        </div>
      </div>

      {lint &&
        (lint.review.length > 0 ||
          lint.links.length > 0 ||
          lint.syntax.errors.length > 0 ||
          lint.syntax.warnings.length > 0 ||
          (gsm?.warnings.length ?? 0) > 0) && (
          <div className="flex flex-col gap-2">
            {lint.syntax.errors.map((m) => (
              <Banner key={m} tone="error" title="Fix before saving">
                {m}
              </Banner>
            ))}
            {lint.syntax.warnings.map((m) => (
              <Banner key={m} tone="warning">
                {m}
              </Banner>
            ))}
            {lint.review.map((r) => (
              <Banner
                key={`${r.rule}:${r.match}`}
                tone="error"
                title="Not allowed in review requests"
              >
                {r.message}
              </Banner>
            ))}
            {lint.links.map((l) => (
              <Banner
                key={l.url}
                tone={l.reason === "shortener" ? "error" : "warning"}
                title={
                  l.reason === "shortener" ? "Link shortener" : "Outside link"
                }
              >
                {l.reason === "shortener"
                  ? `Carriers block shortened links like ${l.url}. Use a link variable such as {{job.link}}.`
                  : `${l.url} isn't on your own domain. Prefer a {{…link}} variable.`}
              </Banner>
            ))}
            {gsm?.warnings.map((w) => (
              <Banner key={w} tone="warning">
                {w}
              </Banner>
            ))}
          </div>
        )}

      <ListSection
        header="Insert a variable"
        footer="Tap to insert at the cursor. {{path|fallback}} shows the fallback when a value is missing."
      >
        <div className="flex flex-col gap-3 px-4 py-3">
          {VARIABLE_GROUPS.filter((g) => staff || !g.staff).map((g) => (
            <div key={g.key}>
              <p className="mb-1 text-subhead font-semibold text-label-2">
                {g.label}
              </p>
              <ChipRow label={`${g.label} variables`}>
                {g.vars.map((v) => (
                  <Chip key={v.path} onClick={() => insert(v.path)}>
                    {v.label}
                  </Chip>
                ))}
              </ChipRow>
            </div>
          ))}
        </div>
      </ListSection>

      <ListSection
        header={
          data?.jobNumber ? `Preview with job ${data.jobNumber}` : "Preview"
        }
        footer="Links show as preview links here; real messages get a fresh secure link."
      >
        <div className="px-4 py-3">
          {data ? (
            <>
              {data.subject && (
                <p className="mb-2 text-headline">{data.subject}</p>
              )}
              {isText ? (
                <MessageBubble direction="out">
                  {data.body || " "}
                </MessageBubble>
              ) : (
                <p className="whitespace-pre-wrap text-body">{data.body}</p>
              )}
              {data.missing.length > 0 && (
                <p className="mt-2 flex items-start gap-1.5 text-footnote text-warning">
                  <AlertTriangle
                    aria-hidden
                    size={14}
                    className="mt-0.5 shrink-0"
                  />
                  No value for {data.missing.map((m) => `{{${m}}}`).join(", ")}{" "}
                  in this example.
                </p>
              )}
            </>
          ) : (
            <p className="text-subhead text-label-2">Loading preview…</p>
          )}
        </div>
      </ListSection>

      <ListSection header="Delivery">
        {isText && (
          <div className="px-4 py-3">
            <TextField
              label="Outbox expiry (minutes)"
              hint="Texts not sent within this time are dropped, never sent late. Blank = no expiry."
              inputMode="numeric"
              value={expires}
              onChange={(e) =>
                setExpires(e.currentTarget.value.replace(/\D/g, ""))
              }
            />
          </div>
        )}
        {isAdmin && isText && (
          <ToggleRow
            title="May send during quiet hours"
            subtitle="Only for live texts the customer expects right now (lead reply, on my way)"
            checked={outside}
            onChange={(e) => setOutside(e.currentTarget.checked)}
          />
        )}
      </ListSection>

      <div className="flex flex-wrap justify-between gap-2">
        <Button
          variant="plain"
          icon={<RotateCcw aria-hidden size={16} />}
          disabled={body === row.defaultBody}
          onClick={reset}
        >
          Reset to default
        </Button>
        <Button
          variant="filled"
          disabled={!dirty || (lint?.blocking.length ?? 0) > 0}
          loading={saving}
          onClick={save}
        >
          Save
        </Button>
      </div>
      {dialog}
    </>
  );
}
