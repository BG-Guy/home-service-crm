"use client";

import {
  Check,
  ClipboardCopy,
  FileImage,
  RefreshCw,
  Send,
  ShieldX,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { useConfirm } from "@/ui/components/Alert";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { TextArea, TextField } from "@/ui/components/Field";
import { ListSection } from "@/ui/components/List";
import { toast } from "@/ui/components/Toast";
import {
  acceptDispute,
  regenerateEvidence,
  saveDisputeEvidence,
  submitDispute,
} from "../actions";

// The attach-a-file picker is a lazy chunk (with the Sheet kit), loaded on first open.
const EvidencePickerSheet = dynamic(() => import("./EvidencePickerSheet"), {
  ssr: false,
});

export interface EditorField {
  key: string;
  label: string;
  multiline?: boolean;
  relevant: boolean;
  value: string;
}
export interface EditorFileSlot {
  key: string;
  label: string;
  mediaId: string | null;
}
export interface EditorMedia {
  id: string;
  thumbUrl: string;
  label: string;
}

/** /disputes/[id] editor: narrative + fields, files, regenerate, Submit / Accept, copy panel. */
export function DisputeEditor({
  disputeId,
  narrative: initialNarrative,
  fields,
  files,
  media,
  editable,
  hasApi,
  suggestAccept,
  amountLabel,
}: {
  disputeId: string;
  narrative: string;
  fields: EditorField[];
  files: EditorFileSlot[];
  media: EditorMedia[];
  editable: boolean;
  hasApi: boolean;
  suggestAccept: boolean;
  amountLabel: string;
}) {
  const [narrative, setNarrative] = useState(initialNarrative);
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, f.value])),
  );
  const [showAll, setShowAll] = useState(false);
  const [pending, start] = useTransition();
  const [confirm, confirmEl] = useConfirm();
  const [picking, setPicking] = useState<string | null>(null);
  const [pickerOpen, setPickerOpenState] = useState(false);
  const [pickerArmed, setPickerArmed] = useState(false);
  const setPickerOpen = (v: boolean) => {
    if (v) setPickerArmed(true);
    setPickerOpenState(v);
  };
  const picker = { show: () => setPickerOpen(true) };
  const dirty =
    narrative !== initialNarrative ||
    fields.some((f) => (values[f.key] ?? "") !== f.value);
  const shown = fields.filter(
    (f) => f.key !== "uncategorized_text" && (showAll || f.relevant),
  );
  const mediaById = new Map(media.map((m) => [m.id, m]));

  const save = () =>
    start(async () => {
      const r = await saveDisputeEvidence({
        disputeId,
        narrative,
        fields: Object.fromEntries(
          fields
            .filter((f) => f.key !== "uncategorized_text")
            .map((f) => [f.key, values[f.key] ?? ""]),
        ),
      });
      if (r.ok) toast.success("Evidence saved");
      else toast.error(r.error);
    });

  const copy = (text: string, what: string) =>
    navigator.clipboard?.writeText(text).then(
      () => toast.success(`${what} copied`),
      () => toast.error("Couldn't copy"),
    );

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {suggestAccept && editable && (
        <Banner
          tone="info"
          title="Consider accepting"
          action={
            <Button
              size="sm"
              variant="tinted"
              onClick={async () => {
                const ok = await confirm({
                  title: `Accept this ${amountLabel} dispute?`,
                  message:
                    "The customer keeps the money and the dispute closes. This can't be undone.",
                  confirmLabel: "Accept",
                  destructive: true,
                });
                if (!ok) return;
                start(async () => {
                  const r = await acceptDispute({ disputeId });
                  if (r.ok) toast.success("Dispute accepted");
                  else toast.error(r.error);
                });
              }}
            >
              Accept
            </Button>
          }
        >
          The amount is small and the job's evidence is thin, so fighting it may
          cost more than it's worth.
        </Banner>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between px-4">
          <h2 className="text-subhead font-semibold text-label-2">Narrative</h2>
          {editable && (
            <Button
              size="sm"
              variant="plain"
              icon={<RefreshCw size={15} />}
              loading={pending}
              onClick={async () => {
                const ok = await confirm({
                  title: "Rebuild from the job?",
                  message:
                    "The narrative and fields are rewritten from the job timeline. Your edits are replaced.",
                  confirmLabel: "Rebuild",
                });
                if (!ok) return;
                start(async () => {
                  const r = await regenerateEvidence({ disputeId });
                  if (r.ok) {
                    toast.success("Rebuilt from the job");
                    window.location.reload();
                  } else toast.error(r.error);
                });
              }}
            >
              Rebuild
            </Button>
          )}
        </div>
        <TextArea
          label="Narrative"
          hideLabel
          value={narrative}
          readOnly={!editable}
          rows={10}
          onChange={(e) => setNarrative(e.currentTarget.value)}
          hint="Written from the job's records (never AI). Keep it factual and neutral."
        />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-4">
          <h2 className="text-subhead font-semibold text-label-2">
            Evidence fields
          </h2>
          <Button
            size="sm"
            variant="plain"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Only relevant" : "All fields"}
          </Button>
        </div>
        {shown.map((f) =>
          f.multiline ? (
            <TextArea
              key={f.key}
              label={f.label}
              value={values[f.key] ?? ""}
              readOnly={!editable}
              rows={3}
              onChange={(e) =>
                setValues((v) => ({ ...v, [f.key]: e.currentTarget.value }))
              }
            />
          ) : (
            <TextField
              key={f.key}
              label={f.label}
              value={values[f.key] ?? ""}
              readOnly={!editable}
              onChange={(e) =>
                setValues((v) => ({ ...v, [f.key]: e.currentTarget.value }))
              }
            />
          ),
        )}
        {editable && (
          <Button
            variant={dirty ? "filled" : "gray"}
            disabled={!dirty}
            loading={pending}
            onClick={save}
          >
            {dirty ? "Save evidence" : "Saved"}
          </Button>
        )}
      </section>

      <ListSection
        header="Files"
        footer="Signatures and photos are locked as evidence once attached."
      >
        {files.map((f) => {
          const m = f.mediaId ? mediaById.get(f.mediaId) : null;
          return (
            <div
              key={f.key}
              className="list-row flex min-h-14 items-center gap-3 px-4 py-2"
            >
              <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-fill-2 text-label-3">
                {m ? (
                  // biome-ignore lint/performance/noImgElement: signed thumbnails
                  <img
                    src={m.thumbUrl}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <FileImage aria-hidden size={20} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body">{f.label}</span>
                <span className="block truncate text-footnote text-label-2">
                  {m ? m.label : f.mediaId ? "Attached" : "Not attached"}
                </span>
              </span>
              {editable && (
                <Button
                  size="sm"
                  variant="gray"
                  onClick={() => {
                    setPicking(f.key);
                    picker.show();
                  }}
                >
                  {f.mediaId ? "Change" : "Attach"}
                </Button>
              )}
            </div>
          );
        })}
      </ListSection>

      {editable && (
        <section className="flex flex-col gap-3">
          {hasApi ? (
            <Button
              size="lg"
              fullWidth
              icon={<Send size={18} />}
              loading={pending}
              disabled={dirty}
              onClick={async () => {
                const ok = await confirm({
                  title: "Submit evidence?",
                  message:
                    "You can submit only once. The card network decides in 60–75 days.",
                  confirmLabel: "Submit",
                });
                if (!ok) return;
                start(async () => {
                  const r = await submitDispute({ disputeId });
                  if (r.ok) toast.success("Evidence submitted");
                  else toast.error(r.error);
                });
              }}
            >
              {dirty ? "Save before submitting" : "Submit evidence"}
            </Button>
          ) : (
            <CopyPanel
              rows={[
                { label: "Narrative", value: narrative },
                ...fields
                  .filter((f) => f.key !== "uncategorized_text")
                  .map((f) => ({ label: f.label, value: values[f.key] ?? "" }))
                  .filter((r) => r.value.trim()),
              ]}
              onCopy={copy}
              onDone={async () => {
                const ok = await confirm({
                  title: "Mark as submitted?",
                  message:
                    "Confirm you pasted the evidence and uploaded the printed pack in your processor dashboard.",
                  confirmLabel: "I submitted it",
                });
                if (!ok) return;
                start(async () => {
                  const r = await submitDispute({ disputeId, manual: true });
                  if (r.ok) toast.success("Marked as submitted");
                  else toast.error(r.error);
                });
              }}
            />
          )}
          {!suggestAccept && (
            <Button
              variant="plain"
              className="text-danger"
              icon={<ShieldX size={18} />}
              onClick={async () => {
                const ok = await confirm({
                  title: `Accept this ${amountLabel} dispute?`,
                  message:
                    "The customer keeps the money and the dispute closes. This can't be undone.",
                  confirmLabel: "Accept",
                  destructive: true,
                });
                if (!ok) return;
                start(async () => {
                  const r = await acceptDispute({ disputeId });
                  if (r.ok) toast.success("Dispute accepted");
                  else toast.error(r.error);
                });
              }}
            >
              Accept dispute instead
            </Button>
          )}
        </section>
      )}

      {pickerArmed && (
        <EvidencePickerSheet
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          disputeId={disputeId}
          files={files}
          media={media}
          picking={picking}
        />
      )}
      {confirmEl}
    </div>
  );
}

function CopyPanel({
  rows,
  onCopy,
  onDone,
}: {
  rows: { label: string; value: string }[];
  onCopy: (text: string, what: string) => void;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Banner tone="info" title="Submit in your processor dashboard">
        No processor connection for evidence uploads. Open the dispute in your
        processor's dashboard, paste each field below, and upload the printed
        evidence pack (Print → Save as PDF).
      </Banner>
      <ul className="list-card">
        {rows.map((r) => (
          <li
            key={r.label}
            className="list-row flex min-h-11 items-center gap-3 px-4 py-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-subhead font-medium">{r.label}</span>
              <span className="line-clamp-2 text-footnote text-label-2">
                {r.value}
              </span>
            </span>
            <Button
              size="sm"
              variant="gray"
              icon={<ClipboardCopy size={15} />}
              onClick={() => onCopy(r.value, r.label)}
              aria-label={`Copy ${r.label}`}
            >
              Copy
            </Button>
          </li>
        ))}
      </ul>
      <Button size="lg" fullWidth icon={<Check size={18} />} onClick={onDone}>
        I submitted it
      </Button>
    </div>
  );
}
