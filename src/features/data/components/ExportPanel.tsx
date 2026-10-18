"use client";

import { Download, PackageOpen } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { ListRow, ListSection } from "@/ui/components/List";
import { Pill } from "@/ui/components/StatusPill";
import { toast } from "@/ui/components/Toast";
import { requestExport } from "../actions";
import type { ExportItem } from "../queries";

const fmtBytes = (n: number | null) =>
  n == null
    ? ""
    : n > 1_048_576
      ? `${(n / 1_048_576).toFixed(1)} MB`
      : `${Math.ceil(n / 1024)} KB`;
/** In the company time zone, so server and browser render the same text (T3-20). */
const fmtWhen = (iso: string, timeZone?: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });

/** "Export everything" + recent exports with 24 h download links. */
export function ExportPanel({
  items,
  canExport,
  timeZone,
}: {
  items: ExportItem[];
  canExport: boolean;
  /** Company time zone (IANA). */
  timeZone?: string;
}) {
  const [pending, start] = useTransition();
  const busy = items.some(
    (i) => i.status === "queued" || i.status === "running",
  );
  return (
    <div className="flex flex-col gap-2">
      <ListSection
        header="Export"
        footer="A zip with every table (JSON), spreadsheets of customers, jobs, invoices, payments and leads, plus your photos. Passwords, keys and gate codes are left out. Download links work for 24 hours."
      >
        {canExport && (
          <ListRow
            icon={<PackageOpen size={17} />}
            iconTone="blue"
            title={busy ? "Preparing your export…" : "Export everything"}
            subtitle={
              busy ? "This takes a minute. Refresh to see the link." : undefined
            }
            onClick={() =>
              start(async () => {
                const r = await requestExport({});
                if (r.ok)
                  toast.success("Export started", {
                    message: "We'll have the zip ready in a minute.",
                  });
                else toast.error(r.error);
              })
            }
            disabled={pending || busy}
            accessory="none"
          />
        )}
        {items.map((e) => (
          <ListRow
            key={e.id}
            icon={<Download size={17} />}
            iconTone={e.status === "ready" ? "green" : "gray"}
            title={fmtWhen(e.createdAt, timeZone)}
            subtitle={[
              e.requestedBy,
              fmtBytes(e.bytes),
              e.rows != null ? `${e.rows.toLocaleString()} rows` : null,
              e.error,
            ]
              .filter(Boolean)
              .join(" · ")}
            detail={
              e.status === "ready" ? undefined : (
                <Pill
                  size="sm"
                  tone={
                    e.status === "failed"
                      ? "red"
                      : e.status === "expired"
                        ? "gray"
                        : "orange"
                  }
                >
                  {e.status === "queued" || e.status === "running"
                    ? "Preparing"
                    : e.status === "failed"
                      ? "Failed"
                      : "Expired"}
                </Pill>
              )
            }
            href={e.status === "ready" ? `/api/export/${e.id}` : undefined}
            external={e.status === "ready"}
          />
        ))}
      </ListSection>
      {canExport && (
        <div className="px-4">
          <Button
            variant="plain"
            size="sm"
            href="/customers/export"
            icon={<Download size={16} aria-hidden />}
          >
            Customers only (CSV)
          </Button>
        </div>
      )}
    </div>
  );
}
