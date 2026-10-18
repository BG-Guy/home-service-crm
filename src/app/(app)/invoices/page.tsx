import { Receipt } from "lucide-react";
import type { Metadata } from "next";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import { ParamSelect } from "@/features/invoices/components/ParamSelect";
import {
  type AgingBucket,
  daysPastDue,
  isDueToday,
} from "@/features/invoices/math";
import {
  getAgingSummary,
  getInvoiceFilterOptions,
  listInvoices,
} from "@/features/invoices/queries";
import { requireUser } from "@/lib/auth/current";
import { getCompanyTimezone } from "@/lib/settings";
import { formatDate } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Button } from "@/ui/components/Button";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { SearchField } from "@/ui/components/SearchField";
import { StatCard } from "@/ui/components/StatCard";
import { StatusPill } from "@/ui/components/StatusPill";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Invoices" };

type SP = Record<string, string | undefined>;

const STATUS_CHIPS = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "overdue", label: "Overdue" },
  { value: "draft", label: "Drafts" },
  { value: "paid", label: "Paid" },
] as const;

const AGING: AgingBucket[] = ["0-30", "31-60", "61-90", "90+"];

function href(sp: SP, patch: SP): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({
    ...sp,
    ...patch,
    cursor: patch.cursor,
  }))
    if (v) next.set(k, v);
  const qs = next.toString();
  return qs ? `/invoices?${qs}` : "/invoices";
}

// Invoices (SPEC M08; BUILD_PLAN Appendix A params): status chips, the aging report
// (0–30 / 31–60 / 61–90 / 90+) by tech and source, search, cursor pages. Techs see
// only invoices for their own jobs (DAL scope in queries.ts).
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const user = await requireUser("invoices.view");
  const params = {
    status: sp.status,
    aging: sp.aging,
    tech: sp.tech,
    source: sp.source,
    revisedAfterPayment: sp.revisedAfterPayment === "1",
    from: sp.from,
    to: sp.to,
    q: sp.q,
    cursor: sp.cursor,
  };
  const office = user.baseRole !== "tech";
  const [{ rows, nextCursor }, aging, opts, tz] = await Promise.all([
    listInvoices(params),
    office
      ? getAgingSummary({ tech: sp.tech, source: sp.source })
      : Promise.resolve(null),
    office ? getInvoiceFilterOptions() : Promise.resolve(null),
    getCompanyTimezone(),
  ]);
  const filtered =
    !!sp.status ||
    !!sp.aging ||
    !!sp.tech ||
    !!sp.source ||
    !!sp.q ||
    sp.revisedAfterPayment === "1";
  const now = new Date();

  return (
    <PageTransition>
      <LargeTitleHeader
        title="Invoices"
        subtitle={
          aging && aging.totalCents > 0 ? (
            <>
              <MoneyText cents={aging.totalCents} /> open
              {aging.overdueCount > 0 ? (
                <>
                  {" · "}
                  <MoneyText cents={aging.overdueCents} /> past due
                </>
              ) : null}
            </>
          ) : undefined
        }
        trailing={<HeaderActions />}
        search={
          <SearchField
            param="q"
            defaultValue={sp.q ?? ""}
            placeholder="Invoice #, customer, job #"
          />
        }
      >
        <ChipRow label="Filter invoices">
          {STATUS_CHIPS.map((c) => (
            <Chip
              key={c.value}
              replace
              href={href(sp, {
                status: c.value || undefined,
                aging: undefined,
              })}
              selected={(sp.status ?? "") === c.value && !sp.aging}
            >
              {c.label}
            </Chip>
          ))}
          {sp.revisedAfterPayment === "1" ? (
            <Chip
              replace
              selected
              href={href(sp, { revisedAfterPayment: undefined })}
            >
              Revised after payment
            </Chip>
          ) : null}
        </ChipRow>
      </LargeTitleHeader>

      <Page className="space-y-6">
        {aging ? (
          <section aria-label="Aging" className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {AGING.map((b) => (
                <StatCard
                  key={b}
                  label={`${b} days`}
                  value={
                    <MoneyText cents={aging.buckets[b].cents} compactWhole />
                  }
                  footnote={`${aging.buckets[b].count} invoice${aging.buckets[b].count === 1 ? "" : "s"}`}
                  href={href(sp, {
                    aging: sp.aging === b ? undefined : b,
                    status: undefined,
                  })}
                  className={
                    sp.aging === b
                      ? "ring-2 ring-accent"
                      : b !== "0-30" && aging.buckets[b].cents > 0
                        ? "text-danger"
                        : undefined
                  }
                />
              ))}
            </div>
            {opts ? (
              <div className="grid grid-cols-2 gap-3">
                {opts.techs.length > 0 ? (
                  <ParamSelect
                    param="tech"
                    label="Technician"
                    placeholder="All techs"
                    options={opts.techs.map((t) => ({
                      value: t.id,
                      label: t.name,
                    }))}
                  />
                ) : null}
                {opts.sources.length > 0 ? (
                  <ParamSelect
                    param="source"
                    label="Lead source"
                    placeholder="All sources"
                    options={opts.sources.map((s) => ({
                      value: s.id,
                      label: s.name,
                    }))}
                  />
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {rows.length === 0 ? (
          <EmptyState
            icon={<Receipt size={44} />}
            title={filtered ? "No matching invoices" : "No invoices yet"}
            message={
              filtered
                ? "Try another filter or search."
                : "Invoices are created from a job and issued when the work is done."
            }
            action={
              filtered ? (
                <Button href="/invoices" variant="tinted">
                  Clear filters
                </Button>
              ) : (
                <Button href="/jobs" variant="tinted">
                  Go to jobs
                </Button>
              )
            }
          />
        ) : (
          <ListSection
            header={sp.aging ? `Aging ${sp.aging} days` : "Invoices"}
          >
            {rows.map((r) => {
              // Company-TZ calendar days (QA2): overdue from the day after the due date.
              const daysPast = r.overdue ? daysPastDue(r.dueAt, now, tz) : 0;
              const sub = [
                r.jobNumber,
                r.techName,
                r.status === "draft"
                  ? `Created ${formatDate(r.createdAt, tz)}`
                  : r.overdue
                    ? `${daysPast} day${daysPast === 1 ? "" : "s"} past due`
                    : r.dueAt && r.balanceCents > 0
                      ? isDueToday(r.dueAt, now, tz)
                        ? "Due today"
                        : `Due ${formatDate(r.dueAt, tz)}`
                      : r.issuedAt
                        ? formatDate(r.issuedAt, tz)
                        : null,
                r.version > 1 ? `v${r.version}` : null,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <ListRow
                  key={r.id}
                  href={`/invoices/${r.id}`}
                  title={
                    <span className="flex items-center gap-2">
                      <span className="truncate">{r.customerName}</span>
                      <StatusPill
                        kind="invoice"
                        status={r.overdue ? "overdue" : r.status}
                        size="sm"
                      />
                    </span>
                  }
                  subtitle={`${r.number}${sub ? ` · ${sub}` : ""}`}
                  detail={
                    <span className="flex flex-col items-end">
                      <MoneyText
                        cents={
                          r.status === "paid" || r.status === "draft"
                            ? r.totalCents
                            : r.balanceCents
                        }
                        className="text-label"
                      />
                      {r.balanceCents > 0 &&
                      r.balanceCents !== r.totalCents &&
                      r.status !== "draft" ? (
                        <span className="text-footnote">
                          of <MoneyText cents={r.totalCents} />
                        </span>
                      ) : null}
                    </span>
                  }
                  multiline
                />
              );
            })}
          </ListSection>
        )}

        {nextCursor ? (
          <div className="flex justify-center">
            <Button href={href(sp, { cursor: nextCursor })} variant="gray">
              Older invoices
            </Button>
          </div>
        ) : null}
      </Page>
    </PageTransition>
  );
}
