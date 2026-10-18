import Link from "next/link";
import { EmptyState } from "@/ui/components/EmptyState";
import { MoneyText } from "@/ui/components/MoneyText";
import type { SourceRoiRow } from "../kpis";
import { DASH, pct, plural } from "./bits";

/** Lead-source ROI (SPEC M20): leads, booked, revenue, cost, CPL, cost/booked, ROAS. */
export function SourceRoi({
  rows,
  rq,
  exportHref,
}: {
  rows: SourceRoiRow[];
  rq: string;
  exportHref: string | null;
}) {
  if (rows.length === 0)
    return (
      <div className="rounded-card bg-card">
        <EmptyState
          compact
          title="No leads in this period"
          message="Leads from your website form, Google, Thumbtack and phone calls show up here with their cost and return."
        />
      </div>
    );
  const href = (r: SourceRoiRow) =>
    r.sourceId ? `/leads?source=${r.sourceId}&${rq}` : `/leads?${rq}`;
  return (
    <div className="overflow-hidden rounded-card bg-card">
      <ul className="md:hidden">
        {rows.map((r) => (
          <li
            key={r.sourceId ?? "none"}
            className="hairline-b last:shadow-none"
          >
            <Link
              href={href(r)}
              className="row-press flex flex-col gap-0.5 px-4 py-3"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate text-body font-medium">{r.name}</span>
                <span className="num text-body font-semibold">
                  {r.roas == null ? DASH : `${r.roas.toFixed(1)}×`}
                </span>
              </span>
              <span className="num text-footnote text-label-2">
                {plural(r.leads, "lead")} · {r.booked} booked (
                {pct(r.leads ? r.booked / r.leads : null)}) ·{" "}
                <MoneyText cents={r.revenueCents} compactWhole /> on{" "}
                <MoneyText cents={r.costCents} compactWhole />
                {r.cplCents != null && (
                  <>
                    {" "}
                    · CPL <MoneyText cents={r.cplCents} compactWhole />
                  </>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <table className="hidden w-full text-left text-subhead md:table">
        <caption className="sr-only">Lead source return on spend</caption>
        <thead className="text-footnote text-label-2">
          <tr className="hairline-b">
            <th scope="col" className="px-4 py-2 font-medium">
              Source
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Leads
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Booked
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Revenue
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Cost
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              CPL
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Cost / booked
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              ROAS
            </th>
          </tr>
        </thead>
        <tbody className="num">
          {rows.map((r) => (
            <tr
              key={r.sourceId ?? "none"}
              className="hairline-b last:shadow-none"
            >
              <th scope="row" className="px-4 py-2.5 font-medium">
                <Link href={href(r)} className="hover:underline">
                  {r.name}
                </Link>
              </th>
              <td className="px-2 text-right">{r.leads}</td>
              <td className="px-2 text-right">{r.booked}</td>
              <td className="px-2 text-right">
                <MoneyText cents={r.revenueCents} compactWhole />
              </td>
              <td className="px-2 text-right">
                <MoneyText cents={r.costCents} compactWhole />
              </td>
              <td className="px-2 text-right">
                {r.cplCents == null ? (
                  DASH
                ) : (
                  <MoneyText cents={r.cplCents} compactWhole />
                )}
              </td>
              <td className="px-2 text-right">
                {r.costPerBookedCents == null ? (
                  DASH
                ) : (
                  <MoneyText cents={r.costPerBookedCents} compactWhole />
                )}
              </td>
              <td className="px-4 text-right font-semibold">
                {r.roas == null ? DASH : `${r.roas.toFixed(1)}×`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {exportHref && (
        <div className="hairline-t px-4 py-2 text-right text-footnote">
          <Link href={exportHref} prefetch={false} className="text-accent-text">
            Export CSV
          </Link>
        </div>
      )}
    </div>
  );
}
