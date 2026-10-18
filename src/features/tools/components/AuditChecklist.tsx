"use client";

import { Check, X } from "lucide-react";
import { useState, useTransition } from "react";
import { registerOfflineActions } from "@/client/offline-registry";
import { queueAction } from "@/client/outbox";
import type { ActionResult } from "@/lib/types";
import { Button } from "@/ui/components/Button";
import { CameraButton } from "@/ui/components/CameraButton";
import { TextField } from "@/ui/components/Field";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import { submitAudit } from "../actions";
import { offlineActions } from "../offline";
import { CONDITION_SEGMENTS, newId } from "./util";

export interface AuditItemView {
  id: string;
  toolId: string;
  name: string;
  serial: string | null;
  assetTag: string | null;
  present: boolean | null;
  condition: string | null;
  note: string | null;
  mediaId: string | null;
  photoUrl: string | null;
  toolPhotoUrl: string | null;
}

type Condition = "new" | "good" | "fair" | "poor";

let registered = false;

/** The tech's tool check: per tool "I have it" + timestamped photo, or "Missing". */
export function AuditChecklist({
  auditId,
  items: initial,
}: {
  auditId: string;
  items: AuditItemView[];
}) {
  const [items, setItems] = useState(initial);
  const [pending, start] = useTransition();
  const done = items.filter(
    (i) => i.present === false || (i.present && i.mediaId),
  ).length;

  const save = async (id: string, patch: Partial<AuditItemView>) => {
    const next = {
      ...(items.find((i) => i.id === id) as AuditItemView),
      ...patch,
    };
    setItems((list) => list.map((i) => (i.id === id ? next : i)));
    if (!registered) {
      registerOfflineActions(offlineActions);
      registered = true;
    }
    const r = await queueAction("tools.saveAuditItem", {
      itemId: id,
      present: next.present ?? true,
      condition: next.present ? (next.condition ?? "good") : null,
      mediaId: next.mediaId,
      note: next.note,
      clientId: newId(),
      clientTs: new Date().toISOString(),
    });
    const res = r.result as ActionResult<unknown> | undefined;
    if (res && !res.ok) toast({ title: res.error, tone: "error" });
  };

  const submit = () =>
    start(async () => {
      const r = await submitAudit({ auditId });
      if (!r.ok) {
        toast({ title: r.fieldErrors?.items?.[0] ?? r.error, tone: "error" });
        return;
      }
      toast({
        title: "Tool check submitted",
        message: r.data?.missing
          ? `${r.data.missing} missing tool(s) reported to the office.`
          : "Thanks!",
        tone: r.data?.missing ? "warning" : "success",
      });
    });

  return (
    <div className="flex flex-col gap-4">
      <p className="px-1 text-subhead text-label-2" aria-live="polite">
        {done} of {items.length} checked
      </p>
      <ul className="flex flex-col gap-3">
        {items.map((i) => (
          <li
            key={i.id}
            className={cx(
              "list-card flex flex-col gap-3 p-4",
              i.present === false && "ring-1 ring-[var(--sys-red)]",
            )}
          >
            <div className="flex items-center gap-3">
              {i.photoUrl || i.toolPhotoUrl ? (
                // biome-ignore lint/performance/noImgElement: signed storage thumbnail
                <img
                  src={(i.photoUrl ?? i.toolPhotoUrl) as string}
                  alt=""
                  width={52}
                  height={52}
                  className="size-[52px] shrink-0 rounded-[10px] object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="size-[52px] shrink-0 rounded-[10px] bg-fill-2"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-headline">{i.name}</p>
                <p className="truncate text-footnote text-label-2">
                  {[i.assetTag, i.serial && `S/N ${i.serial}`]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {i.present && i.mediaId && (
                <Check
                  aria-label="Checked"
                  className="text-[var(--sys-green)]"
                  size={22}
                />
              )}
              {i.present === false && (
                <X aria-label="Missing" className="text-danger" size={22} />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <CameraButton
                kind="photo"
                tag="tool"
                entity={{ type: "tool_audit", id: auditId }}
                label={
                  i.mediaId && i.present ? "Retake photo" : "I have it — photo"
                }
                variant={i.mediaId && i.present ? "gray" : "filled"}
                showLibrary={false}
                onUploaded={(r) =>
                  void save(i.id, {
                    present: true,
                    mediaId: r.mediaId,
                    condition: i.condition ?? "good",
                  })
                }
                onError={(e) =>
                  toast({
                    title: "Photo failed",
                    message: e.message,
                    tone: "error",
                  })
                }
              />
              <Button
                size="sm"
                variant={i.present === false ? "destructive" : "plain"}
                onClick={() =>
                  void save(i.id, { present: false, mediaId: null })
                }
              >
                Missing
              </Button>
            </div>
            {i.present && (
              <SegmentedControl
                label={`Condition of ${i.name}`}
                value={(i.condition ?? "good") as Condition}
                segments={CONDITION_SEGMENTS}
                onChange={(c) => void save(i.id, { condition: c })}
              />
            )}
            {i.present === false && (
              <TextField
                label="Where did you last have it?"
                defaultValue={i.note ?? ""}
                onBlur={(e) =>
                  void save(i.id, { note: e.currentTarget.value || null })
                }
              />
            )}
          </li>
        ))}
      </ul>
      <Button
        size="lg"
        fullWidth
        loading={pending}
        disabled={done < items.length}
        onClick={submit}
      >
        Submit tool check
      </Button>
    </div>
  );
}
