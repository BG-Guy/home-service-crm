import { CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import {
  ApproveAllCleanButton,
  DecisionBar,
} from "@/features/approvals/components/DecisionBar";
import { ScopeControl } from "@/features/approvals/components/ScopeControl";
import { listApprovals } from "@/features/approvals/queries";
import { formatRelative } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { EmptyState } from "@/ui/components/EmptyState";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Approvals" };

const KIND_SHORT: Record<string, string> = {
  odometer: "Odometer",
  fuel: "Fuel",
  service: "Service",
  document: "Documents",
  inspection: "Inspections",
  trip: "Trips",
  part_purchase: "Receipts",
  job_cancel: "Cancellations",
  job_start: "Job starts",
  settlement_flag: "Pay flags",
};

/** A kind's server component failing must not take the whole queue down. */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error("[approvals] kind render failed", err);
    return fallback;
  }
}

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const kind = typeof sp.kind === "string" ? sp.kind : undefined;
  const scope = sp.scope === "done" ? "done" : "pending";
  const { kinds, entries, counts } = await listApprovals({ kind, scope });
  const types = kinds.flatMap((k) => k.entityTypes);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const cleanCount =
    scope === "pending"
      ? entries.filter((e) => e.kind.clean?.(e.row)).length
      : 0;
  const q = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const next = {
      kind,
      scope: scope === "done" ? "done" : undefined,
      ...patch,
    };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/approvals?${s}` : "/approvals";
  };

  // Server-render Row + Detail + edit fields for every item (kinds own their evidence UI).
  const cards = await Promise.all(
    entries.map(async (e) => ({
      e,
      row: await safe(() => e.kind.Row({ approval: e.row }), e.kind.label),
      detail:
        scope === "pending"
          ? await safe(() => e.kind.Detail({ approval: e.row }), null)
          : null,
      fields:
        scope === "pending" && e.kind.editFields
          ? await e.kind.editFields(e.row).catch(() => [])
          : [],
      href: e.kind.href?.(e.row) ?? null,
    })),
  );

  return (
    <PageTransition>
      <LargeTitleHeader
        title="Approvals"
        subtitle={
          total > 0 ? `${total} waiting for you` : "Nothing waiting for you"
        }
        trailing={<HeaderActions />}
      />
      <Page wide>
        <div className="flex flex-col gap-[var(--section-gap)]">
          <div className="flex flex-col gap-3">
            <ChipRow label="Approval type">
              <Chip
                href={q({ kind: undefined })}
                selected={!kind}
                replace
                count={total}
              >
                All
              </Chip>
              {types.map((t) => (
                <Chip
                  key={t}
                  href={q({ kind: t })}
                  selected={kind === t}
                  replace
                  count={counts[t] ?? 0}
                >
                  {KIND_SHORT[t] ?? t}
                </Chip>
              ))}
            </ChipRow>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <ScopeControl
                key={scope}
                scope={scope}
                pendingHref={q({ scope: undefined })}
                doneHref={q({ scope: "done" })}
              />
              <ApproveAllCleanButton count={cleanCount} entityType={kind} />
            </div>
          </div>

          {cards.length === 0 ? (
            <div className="list-card">
              <EmptyState
                icon={<CircleCheck size={44} strokeWidth={1.5} />}
                title={
                  scope === "done" ? "Nothing decided lately" : "All caught up"
                }
                message={
                  scope === "done"
                    ? "Approvals decided in the last 14 days show up here."
                    : "Receipts, vehicle logs, cancellations, job starts and pay flags that need a decision appear here."
                }
              />
            </div>
          ) : (
            cards.map(({ e, row, detail, fields, href }) => {
              const title = `${e.kind.label}${e.requestedByName ? ` · ${e.requestedByName}` : ""}`;
              return (
                <article
                  key={e.row.id}
                  id={`approval-${e.row.id}`}
                  className="list-card flex flex-col gap-4 p-4"
                  aria-label={title}
                >
                  <header className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-footnote font-semibold text-label-2">
                        {KIND_SHORT[e.row.entityType] ?? e.kind.label}
                        {e.requestedByName ? ` · ${e.requestedByName}` : ""}
                      </p>
                      <div className="mt-0.5 text-headline">{row}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {scope === "pending" && e.kind.clean?.(e.row) && (
                        <Pill tone="green" size="sm" dot>
                          Clean
                        </Pill>
                      )}
                      {scope === "done" ? (
                        <StatusPill
                          kind="approval"
                          status={e.row.status}
                          size="sm"
                        />
                      ) : null}
                      <time
                        className="text-footnote text-label-2"
                        dateTime={e.row.createdAt.toISOString()}
                      >
                        {formatRelative(e.row.createdAt)}
                      </time>
                    </div>
                  </header>
                  {detail}
                  {scope === "pending" ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <DecisionBar
                        approvalId={e.row.id}
                        title={title}
                        editFields={fields}
                      />
                      {href && (
                        <Link
                          href={href}
                          className="text-subhead text-accent-text"
                        >
                          Open record
                        </Link>
                      )}
                    </div>
                  ) : (
                    <p className="text-footnote text-label-2">
                      {e.row.status === "approved" ? "Approved" : "Rejected"}
                      {e.reviewerName
                        ? ` by ${e.reviewerName}`
                        : " automatically"}
                      {e.row.reason ? ` · ${e.row.reason}` : ""}
                    </p>
                  )}
                </article>
              );
            })
          )}
        </div>
      </Page>
    </PageTransition>
  );
}
