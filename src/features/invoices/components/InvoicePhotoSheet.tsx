"use client";

import { Check, ImageOff, X } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  type CaptureConfig,
  getCaptureConfig,
  listPickablePhotos,
  type PickablePhoto,
  updatePhoto,
} from "@/features/media/actions";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { CameraButton } from "@/ui/components/CameraButton";
import { IconButton } from "@/ui/components/IconButton";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { Skeleton } from "@/ui/components/Skeleton";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import { setInvoicePhotos } from "../actions";
import {
  INVOICE_LABEL_TAGS,
  INVOICE_PHOTO_TAGS,
  type InvoiceLabelTag,
  invoiceLabelTag,
  invoicePhotoLabel,
} from "../photo-labels";

// "Choose photos" (Quote to Paid I5, the owner's note): pick the job photos the
// customer sees on the invoice, in order, each labeled Before, During or After
// ("Problem" photos read as Before; estimate-only "Goal" photos aren't offered).
// Picking is what shows a photo: none picked = no photos. A photo taken here is
// picked right away. Plain photos, no stamps or effects.

const MAX = 8;
const LABELS: Record<InvoiceLabelTag, string> = {
  before: "Before",
  during: "During",
  after: "After",
};

export function InvoicePhotoSheet({
  open,
  onOpenChange,
  invoiceId,
  jobId,
  selected,
  issued,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  jobId: string;
  /** The photos on the invoice now, in order. */
  selected: string[];
  issued: boolean;
}) {
  const [photos, setPhotos] = useState<PickablePhoto[] | null>(null);
  const [cfg, setCfg] = useState<CaptureConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<string[]>(selected);
  const [reload, setReload] = useState(0);
  const [newTag, setNewTag] = useState<InvoiceLabelTag>("after");
  const [saving, startSave] = useTransition();
  const [labeling, setLabeling] = useState<string | null>(null);

  // Each open starts from what's on the invoice now.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when it opens
  useEffect(() => {
    if (open) setOrder(selected);
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload re-fetches
  useEffect(() => {
    if (!open) return;
    let live = true;
    Promise.all([
      listPickablePhotos({ jobId, tags: [...INVOICE_PHOTO_TAGS] }),
      cfg ? null : getCaptureConfig(),
    ]).then(([r, c]) => {
      if (!live) return;
      if (r.ok) setPhotos(r.data ?? []);
      else setError(r.error);
      if (c?.ok && c.data) setCfg(c.data);
    });
    return () => {
      live = false;
    };
  }, [open, jobId, reload]);

  const byId = useMemo(
    () => new Map((photos ?? []).map((p) => [p.id, p])),
    [photos],
  );
  const changed =
    order.length !== selected.length ||
    order.some((id, i) => id !== selected[i]);

  const toggle = (id: string) =>
    setOrder((o) =>
      o.includes(id)
        ? o.filter((x) => x !== id)
        : o.length >= MAX
          ? o
          : [...o, id],
    );

  const relabel = async (p: PickablePhoto, tag: InvoiceLabelTag) => {
    if (invoiceLabelTag(p.tag) === tag) return;
    setLabeling(p.id);
    const r = await updatePhoto({ mediaId: p.id, tag });
    setLabeling(null);
    if (r.ok)
      setPhotos((xs) =>
        (xs ?? []).map((x) => (x.id === p.id ? { ...x, tag } : x)),
      );
    else toast({ title: r.error, tone: "error" });
  };

  const save = () =>
    startSave(async () => {
      const r = await setInvoicePhotos({
        invoiceId,
        showPhotos: order.length > 0,
        photoMediaIds: order,
      });
      if (r.ok) {
        toast({
          title: order.length ? "Photos updated" : "Photos removed",
          tone: "success",
        });
        onOpenChange(false);
      } else toast({ title: r.error, tone: "error" });
    });

  const canTake = !!cfg?.photos && !!cfg.canUpload;
  const labelsOn = cfg?.beforeAfter !== false;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Photos on the invoice"
      detents={["large"]}
      dirty={changed}
      discardConfirm={{ title: "Discard the photo changes?" }}
      leading={
        <Button variant="plain" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      }
      footer={
        <Button size="lg" fullWidth loading={saving} onClick={save}>
          {order.length
            ? `Save · ${order.length} photo${order.length === 1 ? "" : "s"}`
            : "Save · no photos"}
        </Button>
      }
    >
      <div className="flex flex-col gap-5 pb-4">
        <p className="px-1 text-subhead text-label-2">
          Tap the photos the customer should see. They show in this order, each
          labeled Before, During or After.
        </p>
        {issued ? (
          <Banner tone="info">
            Photos on an issued invoice are kept as evidence and can&apos;t be
            deleted.
          </Banner>
        ) : null}

        {order.length > 0 && photos ? (
          <section
            aria-labelledby="inv-picked-h"
            className="flex flex-col gap-2"
          >
            <h3
              id="inv-picked-h"
              className="px-1 text-subhead font-semibold text-label-2"
            >
              On the invoice
            </h3>
            <ul className="flex flex-col gap-2">
              {order.map((id, i) => {
                const p = byId.get(id);
                if (!p) return null;
                const tag = invoiceLabelTag(p.tag);
                return (
                  <li
                    key={id}
                    className="flex items-center gap-3 rounded-card bg-card p-2 shadow-card"
                  >
                    {/* biome-ignore lint/performance/noImgElement: signed thumbnails */}
                    <img
                      src={p.thumbUrl}
                      alt=""
                      className="shrink-0 rounded-[10px] bg-fill-2 object-cover"
                      style={{ width: 48, height: 48 }}
                    />
                    {labelsOn ? (
                      <fieldset className="grid min-w-0 flex-1 grid-cols-3 gap-1.5">
                        <legend className="sr-only">
                          Label for photo {i + 1}
                        </legend>
                        {INVOICE_LABEL_TAGS.map((t) => (
                          <button
                            key={t}
                            type="button"
                            aria-pressed={tag === t}
                            disabled={labeling === id}
                            onClick={() => relabel(p, t)}
                            className={cx(
                              "pressable flex min-h-11 items-center justify-center rounded-[10px] px-3 text-subhead font-semibold",
                              // Picked = ink, like a selected chip: the sheet's
                              // one filled button stays Save.
                              tag === t
                                ? "bg-label text-bg"
                                : "bg-fill-2 text-label",
                            )}
                          >
                            {LABELS[t]}
                          </button>
                        ))}
                      </fieldset>
                    ) : (
                      <span className="min-w-0 flex-1 text-subhead">
                        {invoicePhotoLabel(p.tag)}
                      </span>
                    )}
                    <IconButton
                      label={`Take photo ${i + 1} off the invoice`}
                      size={36}
                      onClick={() => toggle(id)}
                    >
                      <X size={18} aria-hidden />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section
          aria-labelledby="inv-job-photos-h"
          className="flex flex-col gap-2"
        >
          <div className="flex items-baseline justify-between gap-2 px-1">
            <h3
              id="inv-job-photos-h"
              className="text-subhead font-semibold text-label-2"
            >
              Job photos
            </h3>
            <p className="text-footnote text-label-2" aria-live="polite">
              {order.length} of {MAX} picked
            </p>
          </div>
          {error ? (
            <Banner tone="error">{error}</Banner>
          ) : !photos ? (
            <div className="grid grid-cols-4 gap-1">
              {Array.from({ length: 8 }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton
                <Skeleton key={i} className="aspect-square rounded-[8px]" />
              ))}
            </div>
          ) : photos.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-6 text-center text-label-2">
              <ImageOff aria-hidden size={28} />
              <p className="text-subhead">No job photos yet.</p>
            </div>
          ) : (
            <ul className="grid grid-cols-4 gap-1 md:grid-cols-6">
              {photos.map((p) => {
                const idx = order.indexOf(p.id);
                const on = idx >= 0;
                const label = invoicePhotoLabel(p.tag);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      aria-label={`${label} photo${p.caption ? `: ${p.caption}` : ""}${on ? `, number ${idx + 1} on the invoice` : ""}`}
                      onClick={() => toggle(p.id)}
                      className={cx(
                        "pressable relative block aspect-square w-full overflow-hidden rounded-[8px] bg-fill-2 outline-offset-2",
                        on && "ring-[3px] ring-accent ring-inset",
                      )}
                    >
                      {/* biome-ignore lint/performance/noImgElement: signed thumbnails */}
                      <img
                        src={p.thumbUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className={cx(
                          "size-full object-cover transition-opacity",
                          !on && order.length >= MAX && "opacity-40",
                        )}
                      />
                      <span className="absolute bottom-1 left-1 rounded-pill bg-black/55 px-1.5 py-px text-[11px] font-semibold text-white">
                        {label}
                      </span>
                      {on && (
                        <span className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-accent-fill text-footnote font-bold text-on-accent shadow">
                          {order.length > 1 ? (
                            idx + 1
                          ) : (
                            <Check size={14} strokeWidth={3} aria-hidden />
                          )}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {canTake ? (
          <section aria-labelledby="inv-take-h" className="flex flex-col gap-2">
            <h3
              id="inv-take-h"
              className="px-1 text-subhead font-semibold text-label-2"
            >
              Take a photo
            </h3>
            {labelsOn ? (
              <SegmentedControl<InvoiceLabelTag>
                label="New photo's label"
                value={newTag}
                onChange={setNewTag}
                segments={INVOICE_LABEL_TAGS.map((t) => ({
                  value: t,
                  label: LABELS[t],
                }))}
              />
            ) : null}
            <CameraButton
              kind="photo"
              tag={labelsOn ? newTag : "during"}
              jobId={jobId}
              entity={{ type: "job", id: jobId }}
              keepOriginal={
                !!cfg?.keepOriginals &&
                cfg.keepOriginalTags.includes(labelsOn ? newTag : "during")
              }
              label={`${labelsOn ? LABELS[newTag] : "Take"} photo`}
              libraryLabel="From the phone"
              fullWidth
              onUploaded={(r) => {
                setOrder((o) =>
                  o.includes(r.mediaId) || o.length >= MAX
                    ? o
                    : [...o, r.mediaId],
                );
                setReload((n) => n + 1);
              }}
            />
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}
