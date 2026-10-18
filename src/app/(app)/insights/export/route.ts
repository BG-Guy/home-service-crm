import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  getAdminKpis,
  getLeadSourceRoi,
  getTechLeaderboard,
  toCsv,
} from "@/features/insights/kpis";
import { resolvePeriod } from "@/features/insights/period";
import { writeAudit } from "@/lib/audit";
import { actorOf, requireUser } from "@/lib/auth/current";
import { getCompanyTimezone, getSettings } from "@/lib/settings";

// CSV export of an Insights report (SPEC M20 `reports.export`; BUILD_PLAN §9 B8).
// GET /insights/export?report=kpis|leaderboard|sources&period=…&from=&to=
export async function GET(req: Request) {
  const user = await requireUser("reports.export");
  const url = new URL(req.url);
  const report = url.searchParams.get("report") ?? "kpis";
  const [tz, settings] = await Promise.all([
    getCompanyTimezone(),
    getSettings(),
  ]);
  const p = resolvePeriod(
    {
      period: url.searchParams.get("period"),
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    },
    new Date(),
    tz,
    { weekStartsOn: settings.insights.week_starts_on },
  );
  let rows: Record<string, unknown>[];
  if (report === "leaderboard") {
    if (!user.perms.has("insights.view_team"))
      return new NextResponse("Forbidden", { status: 403 });
    rows = (await getTechLeaderboard(p)).map((t) => ({
      tech: t.name,
      jobs_completed: t.completed,
      revenue: (t.revenueCents / 100).toFixed(2),
      avg_ticket:
        t.avgTicketCents == null ? "" : (t.avgTicketCents / 100).toFixed(2),
      close_rate: t.closeRate ?? "",
      callbacks: t.callbacks,
      callback_rate: t.callbackRate ?? "",
      review_clicks: t.reviewClicks,
      reviews_sent: t.reviewsSent,
      readiness_avg: t.readinessAvg ?? "",
      cash_collected: (t.cashCollectedCents / 100).toFixed(2),
      cash_share: t.cashShare ?? "",
    }));
  } else if (report === "sources") {
    if (!user.perms.has("insights.view_financials"))
      return new NextResponse("Forbidden", { status: 403 });
    rows = (await getLeadSourceRoi(p)).map((s) => ({
      source: s.name,
      leads: s.leads,
      booked: s.booked,
      revenue: (s.revenueCents / 100).toFixed(2),
      cost: (s.costCents / 100).toFixed(2),
      cost_per_lead: s.cplCents == null ? "" : (s.cplCents / 100).toFixed(2),
      cost_per_booked:
        s.costPerBookedCents == null
          ? ""
          : (s.costPerBookedCents / 100).toFixed(2),
      roas: s.roas ?? "",
    }));
  } else {
    if (!user.perms.has("insights.view_financials"))
      return new NextResponse("Forbidden", { status: 403 });
    const [cur, prev] = await Promise.all([
      getAdminKpis(p),
      getAdminKpis(p.prev),
    ]);
    rows = Object.keys(cur).map((k) => ({
      kpi: k,
      value: cur[k as keyof typeof cur] ?? "",
      previous: prev[k as keyof typeof prev] ?? "",
    }));
  }
  await db.transaction((tx) =>
    writeAudit(tx, {
      actor: actorOf(user),
      action: "report.exported",
      after: { report, from: p.fromKey, to: p.toKey, rows: rows.length },
      full: true,
    }),
  );
  const name = `${report}-${p.fromKey}-to-${p.toKey}.csv`;
  return new NextResponse(`﻿${toCsv(rows)}\r\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "private, no-store",
    },
  });
}
