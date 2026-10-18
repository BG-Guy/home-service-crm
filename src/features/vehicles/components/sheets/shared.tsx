"use client";

import { FileUp, Paperclip } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { registerOfflineActions } from "@/client/offline-registry";
import { queueAction, queueUpload } from "@/client/outbox";
import type { MediaKind, MediaTag } from "@/client/upload";
import type { ActionResult } from "@/lib/types";
import { Button } from "@/ui/components/Button";
import { CameraButton } from "@/ui/components/CameraButton";
import { toast } from "@/ui/components/Toast";
import { offlineActions } from "../../offline";

// Shared bits for the vehicle log sheets: ids, evidence capture and the
// online-or-queue submit path (offline logs replay through the outbox).

export const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

let registered = false;
function ensureRegistered() {
  if (registered) return;
  registerOfflineActions(offlineActions);
  registered = true;
}

export type SubmitOutcome<T> =
  | { ok: true; queued: boolean; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Run an offline-capable vehicle action: now when online, otherwise persisted in
 * the outbox and replayed (idempotent on clientId).
 */
export async function submitOffline<T>(
  key: string,
  input: Record<string, unknown> & { clientId: string },
): Promise<SubmitOutcome<T>> {
  ensureRegistered();
  const res = await queueAction(key, {
    ...input,
    clientTs: new Date().toISOString(),
  });
  if (res.queued) return { ok: true, queued: true };
  const r = res.result as ActionResult<T> | undefined;
  if (!r) return { ok: true, queued: true };
  if (!r.ok) return { ok: false, error: r.error, fieldErrors: r.fieldErrors };
  return { ok: true, queued: false, data: r.data };
}

/** Toast for a submitted log ("in review" vs "saved" vs "queued"). */
export function toastLogged(
  what: string,
  r: { queued: boolean; data?: { status?: string; flags?: string[] } },
) {
  if (r.queued) {
    toast({
      title: `${what} saved offline`,
      message: "It will sync when you're back online.",
      tone: "warning",
    });
    return;
  }
  if (r.data?.status === "pending") {
    toast({
      title: `${what} sent for review`,
      message: r.data.flags?.length
        ? "Something looked unusual, so an admin will check it."
        : "An admin will approve it shortly.",
      tone: "default",
    });
    return;
  }
  toast({ title: `${what} logged`, tone: "success" });
}

export interface Evidence {
  /** Upload client ids (become media.client_id). */
  clientIds: string[];
  /** Media ids known now (online uploads). */
  mediaIds: string[];
  busy: boolean;
}

/** Photo capture bound to a not-yet-created entity (media.entity = planned row id). */
export function EvidenceCamera({
  entityType,
  entityId,
  tag,
  kind = "photo",
  label,
  multiple = false,
  onChange,
}: {
  entityType: string;
  entityId: string;
  tag: MediaTag;
  kind?: MediaKind;
  label: string;
  multiple?: boolean;
  onChange: (e: Evidence) => void;
}) {
  const state = useRef<Evidence>({ clientIds: [], mediaIds: [], busy: false });
  const push = (patch: Partial<Evidence>) => {
    state.current = { ...state.current, ...patch };
    onChange(state.current);
  };
  return (
    <CameraButton
      kind={kind}
      tag={tag}
      entity={{ type: entityType, id: entityId }}
      label={label}
      multiple={multiple}
      showLibrary
      variant="tinted"
      onQueued={(r) =>
        push({ clientIds: [...state.current.clientIds, r.clientId] })
      }
      onUploaded={(r) =>
        push({ mediaIds: [...state.current.mediaIds, r.mediaId] })
      }
      onError={(e) =>
        toast({ title: "Photo failed", message: e.message, tone: "error" })
      }
    />
  );
}

/** Photo or PDF picker for documents (PDFs skip the image pipeline). */
export function DocumentPicker({
  entityType,
  entityId,
  onChange,
}: {
  entityType: string;
  entityId: string;
  onChange: (e: Evidence & { name: string | null }) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setName(file.name);
    try {
      const { sha256Hex } = await import("@/client/image");
      const clientId = newId();
      const r = await queueUpload(file, {
        clientId,
        kind: "document",
        tag: "document",
        entity: { type: entityType, id: entityId },
        clientCapturedAt: new Date(
          file.lastModified || Date.now(),
        ).toISOString(),
        fileLastModified: file.lastModified || null,
        sha256Original: await sha256Hex(file),
      });
      onChange({
        clientIds: [clientId],
        mediaIds: r.mediaId ? [r.mediaId] : [],
        busy: false,
        name: file.name,
      });
    } catch (e) {
      toast({
        title: "Upload failed",
        message: e instanceof Error ? e.message : String(e),
        tone: "error",
      });
      setName(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="tinted"
        icon={<FileUp size={19} aria-hidden />}
        loading={busy}
        onClick={() => input.current?.click()}
      >
        {name ? "Replace file" : "Photo or PDF"}
      </Button>
      {name && (
        <p className="flex items-center gap-1.5 text-footnote text-label-2">
          <Paperclip aria-hidden size={14} /> {name}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void pick(e.currentTarget.files?.[0]);
          e.currentTarget.value = "";
        }}
      />
    </div>
  );
}

/** Footer "Save" button for sheets. */
export function SheetSave({
  pending,
  disabled,
  children = "Save",
  form,
}: {
  pending: boolean;
  disabled?: boolean;
  children?: ReactNode;
  form: string;
}) {
  return (
    <Button
      type="submit"
      form={form}
      size="lg"
      fullWidth
      loading={pending}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}

export function FieldErrors({ errors }: { errors?: string | null }) {
  if (!errors) return null;
  return (
    <p role="alert" className="text-footnote text-danger">
      {errors}
    </p>
  );
}

/** First error of a field from an ActionResult's fieldErrors. */
export const fe = (
  errs: Record<string, string[]> | undefined,
  key: string,
): string | undefined => errs?.[key]?.[0];
