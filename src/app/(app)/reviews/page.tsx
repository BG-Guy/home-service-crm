import { Star } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import { ReceivedButton } from "@/features/reviews/components/ReceivedButton";
import { getReviewsPage } from "@/features/reviews/queries";
import { requireUser } from "@/lib/auth/current";
import { getCompany, isEnabled } from "@/lib/settings";
import {
  addDaysToKey,
  dateKey,
  formatDate,
  parseDateKey,
  safeTimeZone,
  zonedTimeToUtc,
} from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Banner } from "@/ui/components/Banner";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { BarChart } from "@/ui/components/charts";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListGroup, ListRow, ListSection } from "@/ui/components/List";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { StatCard } from "@/ui/components/StatCard";
import { Pill } from "@/ui/components/StatusPill";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Reviews" };

const PERIODS = [
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "365", label: "12 months", days: 365 },
] as const;

const isKey = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

// Review requests (SPEC M14): sent, click rate, internal ratings, per-tech clicks and
// the manual "review received" log. Same ask for every customer (sentiment-neutral).
export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    tech?: string;
    days?: string;
  }>;
}) {
  await requireUser("reviews.view");
  if (!(await isEnabled("reviews"))) notFound();
  const sp = await searchParams;
  const tz = safeTimeZone((await getCompany()).timezone);
  const today = dateKey(new Date(), tz);
  const days = PERIODS.find((p) => p.key === sp.days)?.days ?? 90;
  const fromKey = isKey(sp.from)
    ? (sp.from as string)
    : addDaysToKey(today, -days + 1);
  const toKey = isKey(sp.to) ? (sp.to as string) : today;
  const from = zonedTimeToUtc(parseDateKey(fromKey), tz);
  const to = zonedTimeToUtc(parseDateKey(addDaysToKey(toKey, 1)), tz);
  const {
    overview: o,
    list,
    leaders,
    own,
    canLog,
  } = await getReviewsPage({ from, to }, sp.tech ?? null);
  const clickRate = o.sent ? Math.round((o.clicked / o.sent) * 100) : 0;
  const custom = isKey(sp.from) || isKey(sp.to);

  return (
    <PageTransition>
      <LargeTitleHeader
        title="Reviews"
        trailing={<HeaderActions create={false} />}
      />
      <Page>
        <ListGroup>
          <ChipRow label="Period">
            {PERIODS.map((p) => (
              <Chip
                key={p.key}
                href={`/reviews?days=${p.key}${sp.tech ? `&tech=${sp.tech}` : ""}`}
                selected={!custom && days === p.days}
                replace
              >
                {p.label}
              </Chip>
            ))}
            {custom && (
              <Chip selected>
                {formatDate(from, tz)} –{" "}
                {formatDate(new Date(to.getTime() - 1), tz)}
              </Chip>
            )}
          </ChipRow>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Requests sent" value={o.sent} />
            <StatCard
              label="Opened the link"
              value={`${clickRate}%`}
              footnote={`${o.clicked} of ${o.sent}`}
            />
            <StatCard
              label="Average rating"
              value={o.avgRating === null ? "—" : `${o.avgRating.toFixed(1)} ★`}
              footnote={`${o.rated} rating${o.rated === 1 ? "" : "s"}`}
            />
            <StatCard label="Reviews logged" value={o.received} />
          </div>

          {o.rated > 0 && (
            <div className="rounded-card bg-card p-4 shadow-card">
              <BarChart
                title="Internal ratings"
                orientation="horizontal"
                data={[5, 4, 3, 2, 1].map((n) => ({
                  label: `${n} ★`,
                  value: o.distribution[n - 1] ?? 0,
                  tone: n >= 4 ? "green" : n === 3 ? "orange" : "red",
                }))}
              />
              <p className="mt-2 text-footnote text-label-2">
                Every customer sees the Google button, whatever they rate. Low
                ratings also get an offer for the owner to call.
              </p>
            </div>
          )}

          {!own && leaders.length > 0 && (
            <ListSection
              header="By technician"
              footer="Clicks are counted from the review link, never by asking the customer."
            >
              {leaders.map((l, i) => (
                <ListRow
                  key={l.userId}
                  leading={
                    <span className="num w-6 text-center text-headline text-label-2">
                      {i + 1}
                    </span>
                  }
                  title={l.name}
                  subtitle={`${l.sent} sent · ${l.ratings} rated${l.avgRating ? ` · ${l.avgRating.toFixed(1)} ★` : ""}`}
                  detail={`${l.clicked} clicks`}
                  href={`/reviews?tech=${l.userId}${sp.days ? `&days=${sp.days}` : ""}`}
                />
              ))}
            </ListSection>
          )}

          {sp.tech && !own && (
            <Banner
              tone="info"
              action={
                <a className="text-accent-text" href="/reviews">
                  Show everyone
                </a>
              }
            >
              Showing one technician.
            </Banner>
          )}

          {list.length === 0 ? (
            <EmptyState
              icon={<Star aria-hidden size={44} />}
              title="No review requests yet"
              message="After a paid job, customers get one review request (plus one reminder). They show up here."
            />
          ) : (
            <ListSection header="Recent requests">
              {list.map((r) => (
                <ListRow
                  key={r.id}
                  title={`${r.customerName} · ${r.jobNumber}`}
                  subtitle={[
                    r.techName,
                    r.firstSentAt
                      ? `asked ${formatDate(r.firstSentAt, tz)}`
                      : null,
                    r.sentCount > 1 ? "reminded" : null,
                    r.feedback ? `“${r.feedback.slice(0, 60)}”` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  multiline
                  detail={
                    <span className="flex items-center gap-2">
                      {r.rating !== null && (
                        <Pill
                          tone={
                            r.rating >= 4
                              ? "green"
                              : r.rating === 3
                                ? "orange"
                                : "red"
                          }
                          size="sm"
                        >
                          {r.rating} ★{r.wantsCallback ? " · call" : ""}
                        </Pill>
                      )}
                      {r.receivedAt ? (
                        <Pill tone="green" size="sm">
                          Reviewed
                        </Pill>
                      ) : r.clickedAt ? (
                        <Pill tone="blue" size="sm">
                          Opened
                        </Pill>
                      ) : (
                        <Pill tone="gray" size="sm">
                          Sent
                        </Pill>
                      )}
                      {canLog && !r.receivedAt && r.clickedAt && (
                        <ReceivedButton reviewRequestId={r.id} />
                      )}
                    </span>
                  }
                  // A row with the log button isn't a link (no nested controls).
                  href={
                    canLog && !r.receivedAt && r.clickedAt
                      ? undefined
                      : `/jobs/${r.jobId}`
                  }
                />
              ))}
            </ListSection>
          )}
        </ListGroup>
      </Page>
    </PageTransition>
  );
}
