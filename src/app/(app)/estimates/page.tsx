import { FileText } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import {
  getCloseRates,
  getEstimateTechOptions,
  listEstimates,
} from "@/features/estimates/queries";
import { ParamSelect } from "@/features/invoices/components/ParamSelect";
import { requireUser } from "@/lib/auth/current";
import { formatMoney } from "@/lib/money";
import { getCompanyTimezone, isEnabled } from "@/lib/settings";
import { formatDate, formatRelative } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Button } from "@/ui/components/Button";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { SearchField } from "@/ui/components/SearchField";
import { StatusPill } from "@/ui/components/StatusPill";
import { Morph } from "@/ui/motion/Morph";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Estimates" };

type SP = Record<string, string | undefined>;

const VIEWS = [
  { key: "unsold", label: "Unsold" },
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "approved", label: "Approved" },
  { key: "declined", label: "Declined" },
  { key: "expired", label: "Expired" },
] as const;

function href(sp: SP, patch: SP): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch }))
    if (v) next.set(k, v);
  const qs = next.toString();
  return qs ? `/estimates?${qs}` : "/estimates";
}

// Estimates (SPEC M07): the unsold board (sent/viewed, by value) with close rate per
// tech, plus status views, tech filter and search. Techs see their own estimates.
export default async function EstimatesPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const user = await requireUser("estimates.view");
  if (!(await isEnabled("estimates"))) notFound();
  const view =
    sp.unsold === "1" || (!sp.status && sp.view !== "all")
      ? "unsold"
      : (sp.status ?? "all");
  const unsold = view === "unsold";
  const [rows, rates, techs, tz] = await Promise.all([
    listEstimates({
      unsold,
      status: unsold || view === "all" ? undefined : view,
      tech: sp.tech,
      from: sp.from,
      to: sp.to,
      q: sp.q,
    }),
    unsold ? getCloseRates({ from: sp.from, to: sp.to }) : Promise.resolve([]),
    getEstimateTechOptions(),
    getCompanyTimezone(),
  ]);
  const pipeline = unsold ? rows.reduce((a, r) => a + r.totalCents, 0) : 0;
  const now = new Date();

  return (
    <PageTransition>
      <LargeTitleHeader
        title="Estimates"
        subtitle={
          unsold && rows.length > 0 ? (
            <>
              <MoneyText cents={pipeline} /> unsold · {rows.length} open
            </>
          ) : undefined
        }
        trailing={<HeaderActions own="estimate" />}
        search={
          <SearchField
            param="q"
            defaultValue={sp.q ?? ""}
            placeholder="Estimate #, customer, title"
          />
        }
      >
        <ChipRow label="Estimate views">
          {VIEWS.map((v) => (
            <Chip
              key={v.key}
              replace
              selected={view === v.key}
              href={href(
                { q: sp.q, tech: sp.tech },
                v.key === "unsold"
                  ? {}
                  : v.key === "all"
                    ? { view: "all" }
                    : { status: v.key },
              )}
            >
              {v.label}
            </Chip>
          ))}
        </ChipRow>
      </LargeTitleHeader>

      <Page className="space-y-6">
        {techs.length > 0 ? (
          <div className="max-w-xs">
            <ParamSelect
              param="tech"
              label="Technician"
              placeholder="Everyone"
              options={techs.map((t) => ({ value: t.id, label: t.name }))}
            />
          </div>
        ) : null}

        {unsold && rates.length > 0 ? (
          <ListSection
            variant="title"
            header="Close rate"
            subtitle="Last 90 days"
            footer="Approved ÷ decided (approved, declined or expired) for estimates each person wrote."
          >
            {rates.map((r) => (
              <ListRow
                key={r.userId}
                href={href(sp, { tech: r.userId })}
                title={r.name}
                subtitle={`${r.approved} won · ${r.declined + r.expired} lost · ${r.open} open (${formatMoney(r.openCents)})`}
                detail={
                  <span className="num text-label">
                    {r.rate == null ? "—" : `${r.rate}%`}
                  </span>
                }
              />
            ))}
          </ListSection>
        ) : null}

        {rows.length === 0 ? (
          <EmptyState
            icon={<FileText size={44} />}
            title={
              unsold ? "Nothing waiting on a customer" : "No estimates here"
            }
            message={
              unsold
                ? "Sent estimates that aren't approved yet show up here, biggest first."
                : "Write an estimate from a job, a lead or a customer."
            }
            action={
              user.perms.has("estimates.create") ? (
                <Button href="/estimates/new" variant="tinted">
                  New estimate
                </Button>
              ) : null
            }
          />
        ) : (
          <ListSection
            variant="title"
            header={unsold ? "Unsold, by value" : "Estimates"}
          >
            {rows.map((r) => {
              const expired =
                r.expiresAt && r.expiresAt < now && unsold
                  ? " · past expiry"
                  : "";
              const when =
                r.status === "viewed" && r.viewedAt
                  ? `Viewed ${formatRelative(r.viewedAt, now)}`
                  : r.sentAt
                    ? `Sent ${formatDate(r.sentAt, tz)}`
                    : `Created ${formatDate(r.createdAt, tz)}`;
              return (
                <ListRow
                  key={r.id}
                  href={`/estimates/${r.id}`}
                  title={
                    <span className="flex items-center gap-2">
                      <span className="truncate">{r.customerName}</span>
                      <StatusPill kind="estimate" status={r.status} size="sm" />
                    </span>
                  }
                  subtitle={
                    <>
                      <Morph name={`estimate-${r.id}-title`}>
                        <span className="inline-block">
                          {r.title ? `${r.number} · ${r.title}` : r.number}
                        </span>
                      </Morph>
                      {[
                        "",
                        r.jobNumber,
                        r.createdByName,
                        `${when}${expired}`,
                        r.optionCount > 1 ? `${r.optionCount} options` : null,
                      ]
                        .filter((x, i) => i === 0 || Boolean(x))
                        .join(" · ")}
                    </>
                  }
                  detail={
                    <MoneyText
                      cents={r.totalCents}
                      className="font-semibold text-label"
                    />
                  }
                  multiline
                />
              );
            })}
          </ListSection>
        )}
      </Page>
    </PageTransition>
  );
}
