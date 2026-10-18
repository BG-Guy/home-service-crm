import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/features/tools/components/PrintButton";
import { getTheftReport } from "@/features/tools/queries";
import { requireAnyPerm } from "@/lib/auth/current";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { findCompany, getCompanyTimezone, isEnabled } from "@/lib/settings";
import { formatDateKey, formatDateTime } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { NavBar } from "@/ui/components/NavBar";

export const metadata: Metadata = { title: "Theft report" };

const usd = (c: number | null | undefined) =>
  c == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(c / 100);

/** One-click printable theft/loss report for police and insurance (SPEC M18). */
export default async function TheftReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAnyPerm(["tools.view_all", "tools.report_incident"]);
  if (!(await isEnabled("tools"))) notFound();
  const { id } = await params;
  const [r, company, tz] = await Promise.all([
    getTheftReport(id),
    findCompany(),
    getCompanyTimezone(),
  ]);
  const t = r.tool;
  const incident =
    r.incidents.find((i) => i.kind === "stolen" || i.kind === "lost") ??
    r.incidents[0];
  const rows: [string, string][] = [
    ["Item", t.name],
    ["Brand / model", [t.brand, t.model].filter(Boolean).join(" ") || "—"],
    ["Serial number", t.serial ?? "—"],
    ["Asset tag", t.assetTag ?? "—"],
    ["Category", t.category ?? "—"],
    ["Purchase date", t.purchaseDate ? formatDateKey(t.purchaseDate) : "—"],
    ["Purchase price", usd(t.purchaseCostCents)],
    ["Replacement value", usd(t.replacementCostCents ?? t.purchaseCostCents)],
    [
      "Owner",
      t.owner === "tech_owned"
        ? `Technician (${r.ownerName ?? "—"})`
        : (company?.legalName ?? company?.name ?? "Company"),
    ],
    ["Status", t.status],
    [
      "Last known custody",
      r.lastSeen
        ? `${r.lastSeen.to}, checked out ${formatDateTime(r.lastSeen.outAt, tz)}${r.lastSeen.inAt ? `, returned ${formatDateTime(r.lastSeen.inAt, tz)}` : ""}`
        : "—",
    ],
    ...(incident
      ? ([
          [
            "Reported",
            `${incident.kind} on ${formatDateTime(incident.at, tz)}${incident.reportedBy ? ` by ${incident.reportedBy}` : ""}`,
          ],
          ["Details", incident.description ?? "—"],
          ["Police report #", incident.policeReportNo ?? "—"],
        ] as [string, string][])
      : []),
  ];
  return (
    <>
      <div className="print:hidden">
        <NavBar
          title="Theft report"
          back={{ href: `/tools/${id}`, label: t.name }}
          trailing={<PrintButton />}
        />
      </div>
      <Page className="pt-4 print:p-0">
        <article className="list-card flex flex-col gap-5 p-6 print:shadow-none">
          <header className="flex flex-col gap-1">
            <p className="text-footnote uppercase text-label-2">
              Property loss / theft report
            </p>
            <h1 className="text-title1 font-bold">{t.name}</h1>
            <p className="text-subhead text-label-2">
              {[
                company?.legalName ?? company?.name,
                formatPhoneDisplay(company?.phone),
              ]
                .filter(Boolean)
                .join(" · ")}{" "}
              · Prepared {formatDateTime(new Date(), tz)}
            </p>
          </header>
          <table className="w-full text-subhead">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k} className="border-t border-[var(--sep)] align-top">
                  <th
                    scope="row"
                    className="w-44 py-2 pr-4 text-left font-normal text-label-2"
                  >
                    {k}
                  </th>
                  <td className="py-2">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.photos.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-headline">Photos on file</h2>
              <div className="grid grid-cols-3 gap-2">
                {r.photos.slice(0, 6).map((p) => (
                  // biome-ignore lint/performance/noImgElement: signed storage image for print
                  <img
                    key={p.id}
                    src={p.url || p.thumbUrl}
                    alt={t.name}
                    className="aspect-square w-full rounded-[10px] object-cover"
                  />
                ))}
              </div>
            </section>
          )}
          <p className="text-footnote text-label-2">
            Records kept in the company tool register (custody history with
            timestamped handoff photos).
          </p>
        </article>
      </Page>
    </>
  );
}
