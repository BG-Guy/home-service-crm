import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { payPeriods, settlements, users } from "@/db/schema";
import { payrollCsv } from "@/features/payroll/server/payouts";
import type { SettlementTotalsJson } from "@/features/payroll/server/settlements";
import { requireUser } from "@/lib/auth/current";
import { ForbiddenError } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import { isEnabled } from "@/lib/settings";

// GET /pay/settlements/export[?period=<id>] → CSV for Gusto/ADP (wages vs reimbursements;
// never taxes). Approved, paid and locked statements only.
export async function GET(req: Request): Promise<Response> {
  // An expected denial is a 403, not a 500 with a server error log (QA T3-04).
  try {
    await requireUser("payroll.view_all");
  } catch (err) {
    if (err instanceof ForbiddenError)
      return new Response("Forbidden", { status: 403 });
    throw err;
  }
  if (!(await isEnabled("payroll")))
    return new Response("Not found", { status: 404 });
  const period = new URL(req.url).searchParams.get("period");
  const rows = await db
    .select({
      s: settlements,
      name: users.name,
      email: users.email,
      startsOn: payPeriods.startsOn,
      endsOn: payPeriods.endsOn,
    })
    .from(settlements)
    .innerJoin(users, eq(users.id, settlements.userId))
    .innerJoin(payPeriods, eq(payPeriods.id, settlements.payPeriodId))
    .where(
      and(
        inArray(settlements.status, ["approved", "paid", "locked"]),
        period && isUuid(period)
          ? eq(settlements.payPeriodId, period)
          : undefined,
      ),
    )
    .orderBy(payPeriods.startsOn, users.name);
  const csv = payrollCsv(
    rows.map((r) => ({
      name: r.name,
      email: r.email,
      workerType: r.s.workerType,
      period: `${r.startsOn}..${r.endsOn}`,
      totals: r.s.totals as SettlementTotalsJson,
      closingCents: r.s.closingBalanceCents,
    })),
  );
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="payroll${period ? `-${rows[0]?.startsOn ?? "period"}` : ""}.csv"`,
      "cache-control": "no-store",
    },
  });
}
