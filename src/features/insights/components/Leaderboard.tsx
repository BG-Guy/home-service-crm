import { UserRound } from "lucide-react";
import Link from "next/link";
import { type LinkViewer, profileHref } from "@/lib/links";
import { Avatar } from "@/ui/components/Avatar";
import { MoneyText } from "@/ui/components/MoneyText";
import type { TechRow } from "../kpis";
import { DASH, pct } from "./bits";

function ProfileLink({
  href,
  name,
  className,
}: {
  href: string | null;
  name: string;
  className: string;
}) {
  if (!href) return null;
  return (
    <Link
      href={href}
      transitionTypes={["nav-forward"]}
      aria-label={`${name}'s profile`}
      title={`${name}'s profile`}
      className={`pressable flex shrink-0 items-center justify-center rounded-full text-label-2 hover:bg-fill-2 hover:text-accent-text ${className}`}
    >
      <UserRound size={16} aria-hidden />
    </Link>
  );
}

/**
 * Tech leaderboard (SPEC M20): table on wide screens, stacked cards on phones.
 * Each row drills into that tech's jobs for the period; a person icon beside it
 * opens their profile for viewers who may (managers, or the tech themself).
 */
export function Leaderboard({
  rows,
  rq,
  viewer,
}: {
  rows: TechRow[];
  rq: string;
  viewer: LinkViewer;
}) {
  return (
    <>
      {/* Phones: one card per tech */}
      <ol className="flex flex-col gap-2 md:hidden">
        {rows.map((t, i) => (
          <li key={t.userId} className="flex items-center rounded-card bg-card">
            <Link
              href={`/jobs?tech=${t.userId}&status=completed,closed&${rq}`}
              className="pressable row-press flex min-w-0 flex-1 items-center gap-3 rounded-card p-3"
            >
              <span className="num w-5 text-center text-subhead font-semibold text-label-2">
                {i + 1}
              </span>
              <Avatar name={t.name} seed={t.userId} size={36} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body font-medium">{t.name}</span>
                <span className="text-footnote text-label-2">
                  {t.completed} job{t.completed === 1 ? "" : "s"} · avg{" "}
                  {t.avgTicketCents == null ? (
                    DASH
                  ) : (
                    <MoneyText cents={t.avgTicketCents} compactWhole />
                  )}{" "}
                  · close {pct(t.closeRate)}
                </span>
                <span className="text-footnote text-label-2">
                  Callbacks {pct(t.callbackRate)} · reviews {t.reviewClicks}/
                  {t.reviewsSent} · readiness{" "}
                  {t.readinessAvg == null ? DASH : Math.round(t.readinessAvg)} ·
                  cash {pct(t.cashShare)}
                </span>
              </span>
              <span className="text-body font-semibold">
                <MoneyText cents={t.revenueCents} compactWhole />
              </span>
            </Link>
            <ProfileLink
              href={profileHref(viewer, t.userId)}
              name={t.name}
              className="mr-1 size-11"
            />
          </li>
        ))}
      </ol>
      {/* Wider screens: a real table */}
      <div className="hidden overflow-hidden rounded-card bg-card md:block">
        <table className="w-full text-left text-subhead">
          <caption className="sr-only">Tech leaderboard</caption>
          <thead className="text-footnote text-label-2">
            <tr className="hairline-b">
              <th scope="col" className="px-4 py-2 font-medium">
                Tech
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Jobs
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Revenue
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Avg ticket
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Close
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Callbacks
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Review clicks
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Readiness
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Cash share
              </th>
            </tr>
          </thead>
          <tbody className="num">
            {rows.map((t) => (
              <tr key={t.userId} className="hairline-b last:shadow-none">
                <th scope="row" className="px-4 py-2.5 font-medium">
                  <span className="flex items-center gap-1.5">
                    <Link
                      href={`/jobs?tech=${t.userId}&status=completed,closed&${rq}`}
                      className="flex min-w-0 items-center gap-2 hover:underline"
                    >
                      <Avatar name={t.name} seed={t.userId} size={28} />
                      {t.name}
                    </Link>
                    <ProfileLink
                      href={profileHref(viewer, t.userId)}
                      name={t.name}
                      className="hit-44 size-7"
                    />
                  </span>
                </th>
                <td className="px-2 text-right">{t.completed}</td>
                <td className="px-2 text-right">
                  <MoneyText cents={t.revenueCents} compactWhole />
                </td>
                <td className="px-2 text-right">
                  {t.avgTicketCents == null ? (
                    DASH
                  ) : (
                    <MoneyText cents={t.avgTicketCents} compactWhole />
                  )}
                </td>
                <td className="px-2 text-right">{pct(t.closeRate)}</td>
                <td className="px-2 text-right">
                  {pct(t.callbackRate, 1)}
                  <span className="text-label-3"> ({t.callbacks})</span>
                </td>
                <td className="px-2 text-right">
                  {t.reviewClicks}
                  <span className="text-label-3">/{t.reviewsSent}</span>
                </td>
                <td className="px-2 text-right">
                  {t.readinessAvg == null ? DASH : Math.round(t.readinessAvg)}
                </td>
                <td className="px-4 text-right">{pct(t.cashShare)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
