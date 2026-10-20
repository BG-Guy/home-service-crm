"use client";

import {
  Camera,
  CircleAlert,
  CircleCheck,
  CloudOff,
  ImagePlus,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type Geo, getPosition } from "@/client/geo";
import type { PreparedImage } from "@/client/image";
import { queueUpload } from "@/client/outbox";
import type { MediaKind, MediaTag, UploadMeta } from "@/client/upload";
import { cx } from "../cx";
import { Button, type ButtonVariant } from "./Button";
import { ProgressRing } from "./charts";
import { Spinner } from "./Spinner";

type Status = "processing" | "uploading" | "queued" | "done" | "error";
interface Shot {
  clientId: string;
  preview: string | null;
  progress: number;
  status: Status;
  error?: string;
}

export interface CameraResult {
  clientId: string;
  queued: boolean;
  mediaId?: string;
}

type Uploader = (
  file: Blob,
  meta: UploadMeta,
  opts: { prepared?: PreparedImage; onProgress?: (f: number) => void },
) => Promise<CameraResult>;

const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * Camera capture + upload queue (SPEC §M11, §12.6). Opens the rear camera
 * (`capture="environment"`) or the library, then per photo: compress (1600 px
 * + 320 px thumb, EXIF time/GPS, SHA-256 of the original), geostamp, upload
 * via the outbox (presign → PUT → complete) with progress, queueing offline.
 * Processes one photo at a time to keep memory low on phones. Multi-shot:
 * the tray keeps growing while the button stays ready.
 *
 * ```tsx
 * <CameraButton kind="photo" tag="before" jobId={job.id} entity={{ type: "job", id: job.id }}
 *   onUploaded={(r) => router.refresh()} />
 * ```
 */
export function CameraButton({
  kind = "photo",
  tag = null,
  caption = null,
  entity = null,
  jobId = null,
  keepOriginal = false,
  geo = true,
  label = "Take photo",
  libraryLabel = "Choose from library",
  capture = "environment",
  showLibrary = true,
  multiple = true,
  accept = "image/*",
  variant = "tinted",
  fullWidth,
  upload = queueUpload,
  onQueued,
  onUploaded,
  onError,
  icon,
  className,
}: {
  kind?: MediaKind;
  tag?: MediaTag | null;
  caption?: string | null;
  entity?: { type: string; id: string } | null;
  jobId?: string | null;
  /** Also upload the untouched original (`settings.media.keep_originals`). */
  keepOriginal?: boolean;
  /** Request a location fix for the geostamp (default true). */
  geo?: boolean;
  label?: string;
  libraryLabel?: string;
  /** `environment` (rear), `user` (selfie) or `false` (no camera hint). */
  capture?: "environment" | "user" | false;
  showLibrary?: boolean;
  multiple?: boolean;
  accept?: string;
  variant?: ButtonVariant;
  fullWidth?: boolean;
  /** Override the uploader (tests, public uploads). Default: outbox `queueUpload`. */
  upload?: Uploader;
  /** Each photo accepted by the queue (uploaded now or persisted offline). */
  onQueued?: (r: CameraResult) => void;
  /** Each photo stored on the server. */
  onUploaded?: (r: CameraResult & { mediaId: string }) => void;
  onError?: (error: Error) => void;
  icon?: ReactNode;
  className?: string;
}) {
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const previews = useRef<string[]>([]);
  const busy = shots.some(
    (s) => s.status === "processing" || s.status === "uploading",
  );

  useEffect(
    () => () => {
      for (const u of previews.current) URL.revokeObjectURL(u);
    },
    [],
  );

  const patch = (id: string, p: Partial<Shot>) =>
    setShots((list) =>
      list.map((s) => (s.clientId === id ? { ...s, ...p } : s)),
    );

  const handle = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    const ids = list.map(() => uuid());
    setShots((s) => [
      ...s,
      ...ids.map((clientId) => ({
        clientId,
        preview: null,
        progress: 0,
        status: "processing" as const,
      })),
    ]);
    // One fix per batch, started immediately and shared.
    const fix: Promise<Geo | null> = geo
      ? getPosition({ timeoutMs: 6000 })
      : Promise.resolve(null);
    const { prepareImage } = await import("@/client/image");

    for (let i = 0; i < list.length; i++) {
      const file = list[i] as File;
      const clientId = ids[i] as string;
      try {
        const prepared = await prepareImage(file);
        const preview = URL.createObjectURL(prepared.thumb ?? prepared.main);
        previews.current.push(preview);
        patch(clientId, { preview, status: "uploading" });
        const g = await fix;
        const meta: UploadMeta = {
          clientId,
          kind,
          tag,
          caption,
          entity,
          jobId,
          geo: g,
          fileLastModified: prepared.fileLastModified,
          clientCapturedAt: prepared.capturedAt,
          sha256Original: prepared.sha256Original,
          keepOriginal,
        };
        const r = await upload(file, meta, {
          prepared,
          onProgress: (f) => patch(clientId, { progress: f }),
        });
        patch(clientId, {
          status: r.queued ? "queued" : "done",
          progress: r.queued ? 0 : 1,
        });
        onQueued?.(r);
        if (r.mediaId) onUploaded?.({ ...r, mediaId: r.mediaId });
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        patch(clientId, { status: "error", error: err.message });
        onError?.(err);
      }
    }
  };

  const input = (ref: typeof cameraInput, withCapture: boolean) => (
    <input
      ref={ref}
      type="file"
      accept={accept}
      multiple={multiple}
      capture={withCapture && capture ? capture : undefined}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        const files = e.currentTarget.files;
        void handle(files);
        e.currentTarget.value = "";
      }}
    />
  );

  return (
    <div className={cx("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={variant}
          fullWidth={fullWidth}
          icon={icon ?? <Camera size={19} aria-hidden />}
          onClick={() => cameraInput.current?.click()}
        >
          {label}
        </Button>
        {showLibrary && capture && (
          <Button
            variant="secondary"
            icon={<ImagePlus size={19} aria-hidden />}
            onClick={() => libraryInput.current?.click()}
          >
            {libraryLabel}
          </Button>
        )}
        {input(cameraInput, true)}
        {showLibrary && capture && input(libraryInput, false)}
      </div>
      {shots.length > 0 && (
        <ul
          aria-label="Photos"
          aria-busy={busy || undefined}
          className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
        >
          {shots.map((s) => (
            <li
              key={s.clientId}
              className="enter-pop relative size-16 shrink-0 overflow-hidden rounded-xl bg-fill-2"
            >
              {s.preview && (
                // biome-ignore lint/performance/noImgElement: local object URL
                <img
                  src={s.preview}
                  alt=""
                  className="size-full object-cover"
                />
              )}
              <span
                className={cx(
                  "absolute inset-0 flex items-center justify-center",
                  s.status !== "done" && "bg-black/35",
                )}
              >
                {s.status === "processing" && (
                  <span className="text-white">
                    <Spinner size={22} label="Processing" />
                  </span>
                )}
                {s.status === "uploading" && (
                  <span className="text-white">
                    <ProgressRing
                      value={s.progress}
                      size={30}
                      stroke={3}
                      tone="gray"
                      showValue={false}
                      label="Uploading"
                      className="[&_circle:last-child]:stroke-white"
                    />
                  </span>
                )}
                {s.status === "queued" && (
                  <CloudOff
                    aria-label="Waiting to upload"
                    size={22}
                    className="text-white"
                  />
                )}
                {s.status === "done" && (
                  <CircleCheck
                    aria-label="Uploaded"
                    size={20}
                    className="absolute bottom-1 right-1 rounded-full bg-white text-[var(--sys-green)]"
                  />
                )}
                {s.status === "error" && (
                  <CircleAlert
                    aria-label={s.error ?? "Upload failed"}
                    size={22}
                    className="text-white"
                  />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
