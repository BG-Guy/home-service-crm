import { ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PushedScreen } from "@/features/messaging/components/PushedScreen";
import { AuditTable } from "@/features/notify/components/AuditTable";
import { listAudit } from "@/features/notify/queries";
import { requireUser } from "@/lib/auth/current";
import { getCompany } from "@/lib/settings";
import { safeTimeZone } from "@/lib/time";
import { buttonClass } from "@/ui/components/Button";
import { DateField } from "@/ui/components/DatePicker";
import { EmptyState } from "@/ui/components/EmptyState";
import { Select, TextField } from "@/ui/components/Field";

export const metadata: Metadata = { title: "Audit log" };

// Audit log viewer (SPEC M22): who changed what and when, with before/after diffs.
// Filters by actor, action prefix, entity and date (GET form → shareable URL).
export default async function SettingsAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireUser("audit.view");
  const sp = await searchParams;
  const before = sp.before ? Number(sp.before) : null;
  const [{ rows, nextBefore, actors }, company] = await Promise.all([
    listAudit({
      actor: sp.actor,
      action: sp.action,
      entityType: sp.entityType,
      entityId: sp.entityId,
      from: sp.from,
      to: sp.to,
      before: Number.isFinite(before) ? before : null,
    }),
    getCompany(),
  ]);
  const tz = safeTimeZone(company.timezone);
  const keep = new URLSearchParams(
    Object.entries(sp).filter(
      (e): e is [string, string] => !!e[1] && e[0] !== "before",
    ),
  );
  if (nextBefore) keep.set("before", String(nextBefore));
  return (
    <PushedScreen
      title="Audit log"
      intro="Every change to money, permissions, settings, invoices and customer data — read-only and permanent."
      wide
    >
      <form
        method="get"
        className="mb-[var(--section-gap)] grid grid-cols-2 gap-3 rounded-card bg-card p-4 shadow-card md:grid-cols-3 lg:grid-cols-6"
      >
        <Select
          label="Who"
          name="actor"
          defaultValue={sp.actor ?? ""}
          options={[
            { value: "", label: "Anyone" },
            { value: "system", label: "System" },
            ...actors.map((a) => ({ value: a.id, label: a.name })),
          ]}
        />
        <TextField
          label="Action"
          name="action"
          defaultValue={sp.action ?? ""}
          placeholder="invoice."
        />
        <Select
          label="Entity"
          name="entityType"
          defaultValue={sp.entityType ?? ""}
          options={[
            { value: "", label: "Any" },
            ...[
              "customer",
              "job",
              "invoice",
              "payment",
              "estimate",
              "user",
              "setting",
              "permission",
              "settlement",
              "vehicle",
              "tool",
            ].map((t) => ({ value: t, label: t })),
          ]}
        />
        <TextField
          label="Entity ID"
          name="entityId"
          defaultValue={sp.entityId ?? ""}
        />
        <DateField
          label="From"
          name="from"
          placeholder="Any"
          defaultValue={sp.from ?? ""}
        />
        <DateField
          label="To"
          name="to"
          placeholder="Any"
          defaultValue={sp.to ?? ""}
        />
        <div className="col-span-full flex gap-2">
          <button
            type="submit"
            className={buttonClass({ variant: "filled", size: "sm" })}
          >
            Filter
          </button>
          <Link
            href="/settings/audit"
            className={buttonClass({ variant: "plain", size: "sm" })}
          >
            Clear
          </Link>
        </div>
      </form>
      {rows.length === 0 ? (
        <EmptyState
          icon={<ScrollText aria-hidden size={44} />}
          title="No matching entries"
          message="Try a wider date range or clear the filters."
        />
      ) : (
        <>
          <AuditTable rows={rows} timeZone={tz} />
          {nextBefore && (
            <div className="mt-4 flex justify-center">
              <Link
                href={`/settings/audit?${keep.toString()}`}
                className={buttonClass({ variant: "gray", size: "sm" })}
              >
                Older entries
              </Link>
            </div>
          )}
        </>
      )}
    </PushedScreen>
  );
}
