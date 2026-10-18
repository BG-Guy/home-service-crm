"use client";

import { Camera, CircleCheck, PenLine, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { CameraCaptureButton } from "@/features/media/slots.client";
import { SignatureSheet } from "@/features/signatures/slots.client";
import { formatRelative } from "@/lib/time";
import { Select, TextField } from "@/ui/components/Field";
import { Pill } from "@/ui/components/StatusPill";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import { haptic } from "@/ui/motion/haptics";
import { signChecklistItem } from "../actions";
import { checklistPhotoTag } from "../checklist";
import { isAnswered, OWNERSHIP_PREFIX } from "../machine";
import type { ChecklistItemView } from "../types";
import { runOffline } from "./offline-client";
import { ROW_SEP } from "./sep";
import { atOrBefore, useNow } from "./use-now";

// Job checklist (SPEC M05 "checklist required items"; ownership check template).
// Answers save through the offline outbox ('jobs.checklist'); photo items use S24,
// signature items use S15 with B2's signChecklistItem action.

export function ChecklistClient({
  jobId,
  items: initial,
  editable,
  photosEnabled,
  esignText,
  customerName,
  renderedAt,
}: {
  jobId: string;
  items: ChecklistItemView[];
  editable: boolean;
  photosEnabled: boolean;
  esignText: string;
  customerName: string;
  /** Server render time (ms): relative times match on hydration (QA T1-13). */
  renderedAt: number;
}) {
  const [items, setItems] = useState(initial);
  useEffect(() => setItems(initial), [initial]);
  const [saving, setSaving] = useState<string | null>(null);
  const [now, tick] = useNow(renderedAt);
  const done = items.filter((i) => isAnswered(i)).length;

  const save = async (item: ChecklistItemView, answer: unknown) => {
    const prev = items;
    setItems((cur) =>
      cur.map((i) =>
        i.id === item.id
          ? {
              ...i,
              answer,
              answeredAt: answer == null ? null : new Date().toISOString(),
            }
          : i,
      ),
    );
    setSaving(item.id);
    try {
      const r = await runOffline("jobs.checklist", {
        jobId,
        itemId: item.id,
        answer,
      });
      if (!r.queued && r.result && !r.result.ok) {
        setItems(prev);
        toast.error(r.result.error);
        return;
      }
      if (answer != null && answer !== false) haptic();
    } finally {
      setSaving(null);
      tick();
    }
  };

  const ownership = items.filter((i) => i.id.startsWith(OWNERSHIP_PREFIX));
  const rest = items.filter((i) => !i.id.startsWith(OWNERSHIP_PREFIX));

  const row = (item: ChecklistItemView) => {
    const answered = isAnswered(item);
    const meta =
      answered && item.answeredAt
        ? `${item.answeredByName ? `${item.answeredByName} · ` : ""}${formatRelative(atOrBefore(item.answeredAt, now), now)}`
        : item.required
          ? "Required"
          : "Optional";
    if (item.type === "check")
      return (
        <button
          key={item.id}
          type="button"
          aria-pressed={answered}
          disabled={!editable || saving === item.id}
          onClick={() => void save(item, !answered)}
          className={`${ROW_SEP} row-press flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left outline-offset-[-2px] disabled:opacity-70`}
        >
          <span
            aria-hidden
            className={cx(
              "flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-[background-color,border-color,transform] duration-300 ease-[var(--ease-spring)]",
              answered
                ? "scale-100 border-transparent bg-[var(--sys-green)] text-white"
                : "border-label-3",
            )}
          >
            {answered && (
              <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
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
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={cx("text-body", answered && "text-label-2")}>
              {item.label}
            </span>
            <span className="text-footnote text-label-2">{meta}</span>
          </span>
        </button>
      );
    return (
      <div key={item.id} className={`${ROW_SEP} flex flex-col gap-2 px-4 py-3`}>
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className={cx(
              "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
              answered
                ? "bg-[var(--sys-green)] text-white"
                : "bg-fill text-label-2",
            )}
          >
            {answered ? (
              <CircleCheck size={14} />
            ) : item.type === "photo" ? (
              <Camera size={13} />
            ) : item.type === "signature" ? (
              <PenLine size={13} />
            ) : (
              <span className="size-1.5 rounded-full bg-label-3" />
            )}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-body">{item.label}</span>
            <span className="text-footnote text-label-2">{meta}</span>
          </span>
          {answered && (item.type === "photo" || item.type === "signature") && (
            <Pill tone="green" size="sm">
              {item.type === "photo" ? "Photo saved" : "Signed"}
            </Pill>
          )}
        </div>
        {editable && item.type === "text" && (
          <TextField
            label={item.label}
            hideLabel
            defaultValue={typeof item.answer === "string" ? item.answer : ""}
            placeholder="Type an answer"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (item.answer ?? "")) void save(item, v || null);
            }}
          />
        )}
        {editable && item.type === "number" && (
          <TextField
            label={item.label}
            hideLabel
            type="number"
            inputMode="decimal"
            defaultValue={item.answer == null ? "" : String(item.answer)}
            placeholder="0"
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const v = raw === "" ? null : Number(raw);
              if (v !== item.answer && (v === null || !Number.isNaN(v)))
                void save(item, v);
            }}
          />
        )}
        {editable && item.type === "select" && (
          <Select
            label={item.label}
            hideLabel
            value={typeof item.answer === "string" ? item.answer : ""}
            placeholder="Choose…"
            options={(item.options ?? []).map((o) => ({ value: o, label: o }))}
            onChange={(e) => void save(item, e.target.value || null)}
          />
        )}
        {editable && item.type === "photo" && !answered && photosEnabled && (
          <div>
            <CameraCaptureButton
              jobId={jobId}
              defaultTag={item.photoTag ?? checklistPhotoTag(item)}
              allowedTags={[item.photoTag ?? checklistPhotoTag(item)]}
              label="Take photo"
              multiple={false}
              // The server stores this job's media id for it; while offline the
              // client id stands in and resolves once the upload lands.
              onQueued={(m) => void save(item, m.clientId)}
            />
          </div>
        )}
        {editable && item.type === "signature" && !answered && (
          <div>
            <SignatureSheet
              title={item.label}
              docType="ownership"
              consentText={esignText}
              summaryLines={[item.label]}
              signerNameDefault={customerName}
              action={signChecklistItem.bind(null, jobId, item.id)}
              triggerLabel="Get signature"
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-4 pt-3 pb-1 text-footnote text-label-2">
        <span>
          {done} of {items.length} done
        </span>
        <span
          className="h-1.5 w-24 overflow-hidden rounded-full bg-fill"
          role="progressbar"
          aria-label="Checklist progress"
          aria-valuemin={0}
          aria-valuemax={items.length}
          aria-valuenow={done}
        >
          <span
            className="block h-full rounded-full bg-[var(--sys-green)] transition-[width] duration-500 ease-[var(--ease-spring)]"
            style={{
              width: `${items.length ? (done / items.length) * 100 : 0}%`,
            }}
          />
        </span>
      </div>
      {ownership.length > 0 && (
        <>
          <p className="flex items-center gap-1.5 px-4 pt-2 text-footnote font-semibold text-label-2">
            <ShieldCheck size={14} aria-hidden /> Ownership check (before
            starting)
          </p>
          {ownership.map(row)}
        </>
      )}
      {rest.length > 0 && ownership.length > 0 && (
        <p className="px-4 pt-3 text-footnote font-semibold text-label-2">
          Job checklist
        </p>
      )}
      {rest.map(row)}
    </div>
  );
}
