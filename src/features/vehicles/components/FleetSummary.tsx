import {
  CircleDollarSign,
  Fuel,
  Route,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import type { FleetSummary as FleetSummaryData } from "../contracts";

const usd = (c: number, digits = 0) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(c / 100);

/** Fleet KPIs card (S52 and the /vehicles header). Server-renderable, no client JS. */
export function FleetSummaryView({
  data,
  periodLabel,
  href = "/vehicles",
}: {
  data: FleetSummaryData;
  periodLabel: string;
  href?: string;
}) {
  const items = [
    {
      icon: <CircleDollarSign size={16} aria-hidden />,
      label: "Cost / mile",
      value:
        data.costPerMileCents != null ? usd(data.costPerMileCents, 2) : "—",
      tone: "var(--sys-indigo)",
    },
    {
      icon: <Fuel size={16} aria-hidden />,
      label: "Fuel",
      value: usd(data.fuelSpendCents),
      tone: "var(--sys-green)",
    },
    {
      icon: <Route size={16} aria-hidden />,
      label: "Miles",
      value: new Intl.NumberFormat("en-US").format(data.miles),
      tone: "var(--sys-blue)",
    },
    {
      icon: <Wrench size={16} aria-hidden />,
      label: "Overdue",
      value: String(data.overdueReminders),
      sub: data.dueSoon ? `${data.dueSoon} due soon` : undefined,
      tone: data.overdueReminders ? "var(--sys-red)" : "var(--sys-gray)",
    },
    {
      icon: <TriangleAlert size={16} aria-hidden />,
      label: "Open issues",
      value: String(data.openIssues),
      tone: data.openIssues ? "var(--sys-orange)" : "var(--sys-gray)",
    },
  ];
  return (
    <section aria-label="Fleet summary" className="list-card p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-headline">Fleet</h2>
        <a href={href} className="text-footnote text-accent-text">
          {periodLabel}
        </a>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
        {items.map((i) => (
          <div key={i.label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="flex items-center gap-1.5 text-footnote text-label-2">
              <span style={{ color: i.tone }}>{i.icon}</span>
              {i.label}
            </dt>
            <dd className="num text-title3 font-semibold">{i.value}</dd>
            {i.sub && <dd className="text-caption text-label-2">{i.sub}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}
