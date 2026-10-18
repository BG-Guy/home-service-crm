import { db } from "@/db";
import { exportCustomerRows } from "@/features/customers/queries";
import { toCsv } from "@/features/data/csv";
import { writeAudit } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth/current";
import { jsonError } from "@/lib/http";

// GET /customers/export → customers.csv (customers.export). Audited.
export async function GET() {
  try {
    const user = await requireApiUser("customers.export");
    const rows = await exportCustomerRows();
    await writeAudit(db, {
      actor: { kind: "user", userId: user.id },
      action: "customers.exported",
      after: { rows: rows.length },
      full: true,
    });
    const csv = toCsv(rows);
    const day = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="customers-${day}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
