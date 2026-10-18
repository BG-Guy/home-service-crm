import { eq } from "drizzle-orm";
import { getStorage } from "@/adapters/storage";
import { db } from "@/db";
import { nachaBatches } from "@/db/schema";
import { requireUser } from "@/lib/auth/current";
import { ForbiddenError } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import { isEnabled } from "@/lib/settings";

// GET /pay/settlements/nacha/<batchId> → the stored NACHA (.ach) file (payroll.payout only).
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  // An expected denial is a 403, not a 500 with a server error log (QA T3-04).
  try {
    await requireUser("payroll.payout");
  } catch (err) {
    if (err instanceof ForbiddenError)
      return new Response("Forbidden", { status: 403 });
    throw err;
  }
  if (!(await isEnabled("payroll")))
    return new Response("Not found", { status: 404 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return new Response("Not found", { status: 404 });
  const [b] = await db
    .select()
    .from(nachaBatches)
    .where(eq(nachaBatches.id, id))
    .limit(1);
  if (!b || b.storageKey === "pending")
    return new Response("Not found", { status: 404 });
  let body: Uint8Array;
  try {
    body = await getStorage().get(b.storageKey);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  return new Response(body as unknown as BodyInit, {
    headers: {
      "content-type": "text/plain; charset=us-ascii",
      "content-disposition": `attachment; filename="payroll-${b.effectiveDate}.ach"`,
      "cache-control": "no-store",
    },
  });
}
