"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/ui/components/Button";
import { IconButton } from "@/ui/components/IconButton";
import { Sheet } from "@/ui/components/Sheet";
import { Skeleton } from "@/ui/components/Skeleton";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import { type CardLead, LeadBookingBar, LeadCardBody } from "./LeadCardBody";
import {
  type LeadEnv,
  LeadEnvContext,
  type LeadNotice,
  useLeadEnv,
} from "./lead-env";

/**
 * The lead card sheet (a lazy chunk of LeadCardProvider): a bottom sheet on
 * phones (drag down or ✕ to close, the page steps back behind it), a centered
 * sheet on tablets and desktop. The booking bar is its sticky footer. Toasts
 * can't show above a modal sheet, so changes made in it get their Undo in a bar
 * inside the sheet; one still showing when it closes moves to a toast.
 */
export default function LeadCardSheet({
  open,
  lead,
  loading,
  error,
  onClose,
  onRetry,
}: {
  open: boolean;
  lead: CardLead | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
}) {
  const env = useLeadEnv();
  const [notice, setNotice] = useState<(LeadNotice & { id: number }) | null>(
    null,
  );
  const seq = useRef(0);
  const live = useRef(notice);
  live.current = notice;

  useEffect(() => {
    if (!notice) return;
    const ms = notice.undo ? 5000 : 3000;
    const t = setTimeout(
      () => setNotice((n) => (n?.id === notice.id ? null : n)),
      ms,
    );
    return () => clearTimeout(t);
  }, [notice]);

  // Closing with an Undo still on screen: hand it to the app's toast.
  useEffect(() => {
    if (open) return;
    const n = live.current;
    if (n?.undo)
      toast({ title: n.title, message: n.message, tone: n.tone, undo: n.undo });
    setNotice(null);
  }, [open]);

  const notify = useCallback((n: LeadNotice) => {
    seq.current += 1;
    setNotice({ ...n, id: seq.current });
  }, []);
  const inner = useMemo<LeadEnv>(() => ({ ...env, notify }), [env, notify]);

  return (
    <LeadEnvContext.Provider value={inner}>
      <Sheet
        open={open}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
        label={lead ? `Lead ${lead.name}` : "Lead"}
        detents={["large"]}
        trailing={
          <IconButton
            label="Close"
            variant="secondary"
            size={30}
            onClick={onClose}
          >
            <X size={17} strokeWidth={2.5} />
          </IconButton>
        }
        bodyClassName="pt-1"
        footer={
          lead ? (
            <div className="flex flex-col gap-2">
              {notice && (
                <output
                  key={notice.id}
                  aria-live="polite"
                  className={cx(
                    "flex min-h-12 items-center gap-3 rounded-[16px] px-4 py-2 text-white shadow-[var(--shadow-float)]",
                    "enter-rise",
                  )}
                  // The toast's dark surface, inline (one-off colors stay out of the global CSS).
                  style={{ background: "#0b0b0c" }}
                >
                  <span
                    className="min-w-0 flex-1 truncate text-subhead font-semibold"
                    style={
                      notice.tone === "error" ? { color: "#ff8a80" } : undefined
                    }
                  >
                    {notice.title}
                  </span>
                  {notice.undo && (
                    <button
                      type="button"
                      onClick={() => {
                        const u = notice.undo;
                        setNotice(null);
                        u?.();
                      }}
                      className="hit-44 shrink-0 rounded-pill px-3 py-1 text-subhead font-semibold"
                      style={{
                        background: "rgb(255 255 255 / 0.15)",
                        color: "color-mix(in srgb, var(--accent) 55%, #fff)",
                      }}
                    >
                      Undo
                    </button>
                  )}
                </output>
              )}
              <LeadBookingBar lead={lead} variant="sheet" />
            </div>
          ) : undefined
        }
      >
        {lead ? (
          <LeadCardBody lead={lead} loading={loading} variant="sheet" />
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-headline">{error}</p>
            <Button variant="secondary" size="md" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : (
          <div aria-hidden className="flex flex-col gap-4 pt-2">
            <Skeleton height={30} width="70%" />
            <Skeleton height={28} width="55%" rounded="full" />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton height={150} rounded="card" />
              <Skeleton height={150} rounded="card" />
              <Skeleton height={96} rounded="card" />
              <Skeleton height={96} rounded="card" />
            </div>
          </div>
        )}
      </Sheet>
    </LeadEnvContext.Provider>
  );
}
