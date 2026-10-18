import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { assertEstimateAccess } from "@/features/estimates/access";
import { EstimateDocument } from "@/features/estimates/components/EstimateDocument";
import { loadEstimateDocForViewer } from "@/features/estimates/doc";
import { PrintBar } from "@/features/invoices/components/PrintBar";
import { requireUser } from "@/lib/auth/current";
import { NotFoundError } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import { isEnabled } from "@/lib/settings";

export const metadata: Metadata = { title: "Print estimate" };

// Printable estimate (SPEC M07, §12.5): every option with totals, problem photos,
// the approval record (signature image, time, channel, SHA-256) and full policies.
export default async function EstimatesIdPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ auto?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser("estimates.view");
  if (!(await isEnabled("estimates")) || !isUuid(id)) notFound();
  try {
    await assertEstimateAccess(user, id, "read");
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const doc = await loadEstimateDocForViewer(user, id);
  if (!doc) notFound();
  return (
    <>
      <PrintBar
        backHref={`/estimates/${id}`}
        backLabel="Estimate"
        title={doc.estimate.number}
        autoPrint={sp.auto === "1"}
      />
      <div className="mx-auto max-w-[var(--content-max)] px-[var(--gutter)] py-4 print:max-w-none print:p-0">
        <EstimateDocument doc={doc} />
      </div>
    </>
  );
}
