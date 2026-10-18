"use client";

import { ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/types";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";

/**
 * Upload one image (logo or avatar) straight to storage (queueUpload →
 * presign → PUT → complete), then hand the media id to a B8 server action.
 * Shows the current image, a local preview while uploading, and Remove.
 */
export function ImageUpload({
  kind,
  label,
  currentUrl,
  onSave,
  shape = "rounded",
  size = 72,
  dark,
  hint,
}: {
  kind: "logo" | "avatar";
  label: string;
  currentUrl: string | null;
  onSave: (mediaId: string | null) => Promise<ActionResult<unknown>>;
  shape?: "rounded" | "circle";
  size?: number;
  /** Preview on a dark tile (dark-mode logo). */
  dark?: boolean;
  hint?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, start] = useTransition();
  const shown = preview ?? currentUrl;
  // Sentence case inside a phrase: "Upload logo", "Remove photo" (QA2 re-check).
  const noun = label.charAt(0).toLowerCase() + label.slice(1);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  async function onFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Pick an image (PNG, JPEG or WebP).");
      return;
    }
    setBusy(true);
    setPreview(URL.createObjectURL(file));
    try {
      const [{ queueUpload }, { sha256Hex }] = await Promise.all([
        import("@/client/outbox"),
        import("@/client/image"),
      ]);
      const res = await queueUpload(file, {
        clientId: crypto.randomUUID(),
        kind,
        clientCapturedAt: new Date().toISOString(),
        fileLastModified: file.lastModified,
        sha256Original: await sha256Hex(file),
      });
      if (!res.mediaId) {
        toast.warning("You're offline", {
          message: "Try again when you're back online.",
        });
        setPreview(null);
        return;
      }
      const r = await onSave(res.mediaId);
      if (r.ok) toast.success(`${label} updated`);
      else {
        toast.error(r.error);
        setPreview(null);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div
        className={cx(
          "relative flex shrink-0 items-center justify-center overflow-hidden",
          shape === "circle" ? "rounded-full" : "rounded-[14px]",
          dark ? "bg-[#1c1c1e]" : "bg-fill-2",
        )}
        style={{ width: size, height: size }}
      >
        {shown ? (
          // biome-ignore lint/performance/noImgElement: user-uploaded image from storage / local preview
          <img
            src={shown}
            alt={`${label} preview`}
            className={cx(
              "size-full",
              kind === "logo" ? "object-contain p-1.5" : "object-cover",
              busy && "opacity-50",
            )}
          />
        ) : (
          <ImagePlus aria-hidden className="text-label-3" size={size / 3} />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <div className="text-body font-medium">{label}</div>
        {hint && <div className="text-footnote text-label-2">{hint}</div>}
        <div className="mt-1 flex gap-2">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-label={`Upload ${noun}`}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) void onFile(f);
              e.currentTarget.value = "";
            }}
          />
          <Button
            variant="gray"
            size="sm"
            loading={busy}
            onClick={() => input.current?.click()}
          >
            {shown ? "Replace" : "Upload"}
          </Button>
          {shown && !busy && (
            <Button
              variant="plain"
              size="sm"
              loading={saving}
              aria-label={`Remove ${noun}`}
              icon={<Trash2 aria-hidden size={16} />}
              className="text-danger"
              onClick={() =>
                start(async () => {
                  const r = await onSave(null);
                  if (r.ok) {
                    setPreview(null);
                    toast(`${label} removed`);
                  } else toast.error(r.error);
                })
              }
            >
              Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
