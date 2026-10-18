"use client";

import { CloudCheck, CloudOff, RefreshCw } from "lucide-react";
import { useTransition } from "react";
import { flush, useOutboxState } from "@/client/outbox";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";

/** Finish my day, step 1: changes saved on this phone that haven't synced yet. */
export function SyncStatusCard() {
  const s = useOutboxState();
  const [pending, start] = useTransition();
  const waiting = s.pending + s.uploading;
  const sync = () =>
    start(async () => {
      await flush();
      toast.success("Sync finished");
    });
  return (
    <div className="flex min-h-11 items-center gap-3 px-4 py-3">
      {waiting === 0 ? (
        <CloudCheck
          size={22}
          className="shrink-0 text-[var(--sys-green)]"
          aria-hidden
        />
      ) : (
        <CloudOff
          size={22}
          className="shrink-0 text-[var(--sys-orange)]"
          aria-hidden
        />
      )}
      <div className="min-w-0 flex-1" aria-live="polite">
        <p className="text-body">
          {waiting === 0
            ? "Everything is synced"
            : `${waiting} change${waiting === 1 ? "" : "s"} waiting to sync`}
        </p>
        {waiting > 0 && (
          <p className="text-footnote text-label-2">
            {!s.online
              ? "You're offline — connect to Wi-Fi or cell data."
              : (s.lastError ?? "Keep the app open until it finishes.")}
          </p>
        )}
      </div>
      {waiting > 0 && s.online && (
        <Button
          size="sm"
          variant="tinted"
          loading={pending || s.syncing}
          icon={<RefreshCw size={15} aria-hidden />}
          onClick={sync}
        >
          Sync now
        </Button>
      )}
    </div>
  );
}
