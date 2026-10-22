import { and, desc, eq, inArray } from "drizzle-orm";
import { ChevronDown } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { db } from "@/db";
import { depositRequests } from "@/db/schema";
import {
  DEFAULT_ESIGN_CONSENT,
  loadChangeOrder,
  markEstimateViewed,
} from "@/features/estimates/api";
import { EstimateDocument } from "@/features/estimates/components/EstimateDocument";
import { loadEstimateDoc } from "@/features/estimates/doc";
import { canApproveEstimate } from "@/features/estimates/logic";
import type { DocLineType } from "@/features/invoices/math";
import { payDepositFromPortal } from "@/features/portal/actions";
import {
  EstimateApproval,
  type PortalLine,
} from "@/features/portal/components/EstimateApproval";
import { LazyPresentMode } from "@/features/portal/components/LazyPresentMode";
import {
  PortalExpired,
  PortalFooter,
} from "@/features/portal/components/PortalChrome";
import { PrintButton } from "@/features/portal/components/PrintButton";
import { presentingUser } from "@/features/portal/present";
import { openPortalToken, portalActor } from "@/features/portal/token";
import { getLatestSignature } from "@/features/signatures/api";
import { formatMoney } from "@/lib/money";
import { getCurrentPolicy } from "@/lib/policies";
import { formatDate, formatDateTime } from "@/lib/time";
import { Button } from "@/ui/components/Button";
import { PhotoGrid } from "@/ui/components/PhotoGrid";
import { SuccessCheck } from "@/ui/components/SuccessCheck";

export const metadata: Metadata = {
  title: "Your estimate",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

type LineRowLike = {
  id: string;
  type: string;
  name: string;
  description: string | null;
  qty: number | string;
  totalCents: number;
  taxable: boolean;
  isOptional: boolean;
  isSelected: boolean;
  isServiceFee: boolean;
};

const toPortalLine = (l: LineRowLike): PortalLine => ({
  id: l.id,
  type: l.type as DocLineType,
  name: l.name,
  description: l.description,
  qty: Number(l.qty),
  totalCents: l.totalCents,
  taxable: l.taxable,
  isOptional: l.isOptional,
  isSelected: l.isSelected,
  isServiceFee: l.isServiceFee,
});

// /e/[token] (SPEC M07, M23): view the options, pick one + add-ons, agree to sign
// electronically, type a name, draw a signature, then pay the deposit (B4 /p/).
// Every hit is logged (portal_access_log); the first view flips sent → viewed.
// `?present=1` with a staff session that may present it: the same page, full
// screen on the staff tablet (present mode, `PresentMode`); the approval is
// then recorded as signed in person.
export default async function ETokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ present?: string }>;
}) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const tok = await openPortalToken("estimate", token, "/e/[token]");
  if (!tok) return <PortalExpired what="estimate link" />;
  if (tok.entityType === "change_order")
    return <ChangeOrderView token={token} coId={tok.entityId} />;
  if (tok.entityType !== "estimate") return <PortalExpired />;

  const actor = await portalActor(tok);
  await db
    .transaction((tx) => markEstimateViewed(tx, tok.entityId, tok.id, actor))
    .catch(() => false);
  const doc = await loadEstimateDoc(tok.entityId);
  if (!doc) return <PortalExpired what="estimate" />;
  const e = doc.estimate;
  const tz = doc.timezone;
  const first =
    doc.customer.firstName ?? doc.customer.displayName.split(" ")[0];
  const presenter = sp.present === "1" ? await presentingUser(e.id) : null;
  // Present mode wraps every state of the page (it stays mounted when the
  // approval refreshes it into "Approved").
  const present = (node: ReactNode) =>
    presenter ? (
      <LazyPresentMode
        exitHref={`/estimates/${e.id}`}
        company={doc.company.name}
        heading={`Estimate ${e.number}`}
        customer={first}
        stage={e.status}
      >
        {node}
      </LazyPresentMode>
    ) : (
      node
    );

  if (e.status === "approved") {
    const [dep] = await db
      .select({
        amount: depositRequests.amountCents,
        status: depositRequests.status,
      })
      .from(depositRequests)
      .where(
        and(
          eq(depositRequests.estimateId, e.id),
          inArray(depositRequests.status, ["required", "requested"]),
        ),
      )
      .orderBy(desc(depositRequests.createdAt))
      .limit(1);
    return present(
      <div className="space-y-5 pt-2">
        <section className="card flex flex-col items-center px-6 py-9 text-center print:hidden">
          <SuccessCheck size={64} label="Approved" />
          <h1 className="mt-4 text-title1">Approved, thank you!</h1>
          <p className="mt-1 text-subhead text-label-2">
            {doc.signature
              ? `Signed by ${doc.signature.signerName} on ${formatDateTime(doc.signature.signedAt, tz)}.`
              : "We've got your approval."}{" "}
            We'll be in touch to schedule the work.
          </p>
          {dep ? (
            <form action={payDepositFromPortal} className="mt-6 w-full">
              <input type="hidden" name="token" value={token} />
              <Button type="submit" size="lg" block>
                Pay {formatMoney(dep.amount)} deposit
              </Button>
              <p className="mt-2 text-footnote text-label-2">
                Your deposit holds the parts and the appointment.
              </p>
            </form>
          ) : null}
          <div className="mt-4">
            <PrintButton label="Save a copy" />
          </div>
        </section>
        <EstimateDocument doc={doc} />
        <PortalFooter />
      </div>,
    );
  }

  const approvable = canApproveEstimate(e);
  const terms = (
    <>
      {e.warrantyText ? (
        <section className="card px-5 py-4 text-subhead">
          <h2 className="text-headline">Warranty</h2>
          <p className="mt-1 text-label-2">{e.warrantyText}</p>
        </section>
      ) : null}

      {doc.policies.length > 0 ? (
        <section className="space-y-2" aria-label="Terms">
          <h2 className="px-1 pt-2 text-title3">Terms</h2>
          {doc.policies
            .filter((p) => p.kind !== "esign_consent")
            .map((p) => (
              <details
                key={p.id}
                className="card group px-5 py-1"
                open={p.kind === "cooling_off"}
              >
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-body">
                  {p.title}
                  <span className="flex items-center gap-2 text-footnote text-label-3">
                    v{p.version}
                    <ChevronDown
                      size={18}
                      aria-hidden
                      className="transition-transform duration-[var(--dur-quick)] group-open:rotate-180"
                    />
                  </span>
                </summary>
                <p className="whitespace-pre-line pb-2 text-subhead text-label-2">
                  {p.body.replaceAll("{company}", doc.company.name)}
                </p>
              </details>
            ))}
        </section>
      ) : null}
    </>
  );
  return present(
    <div className="space-y-5 pt-2">
      <section className="px-1 pt-2">
        <p className="num text-subhead font-semibold text-label-2">
          Estimate {e.number}
        </p>
        <h1 className="mt-1 text-large-title">
          {e.title ?? `Hi ${first}, here's your estimate`}
        </h1>
        <p className="mt-2 text-subhead text-label-2">
          {doc.propertyLines[0] ? `${doc.propertyLines[0]} · ` : ""}
          {e.expiresAt
            ? approvable
              ? `Valid until ${formatDate(e.expiresAt, tz)}`
              : `Expired ${formatDate(e.expiresAt, tz)}`
            : ""}
        </p>
      </section>

      {e.status === "declined" ? (
        <div className="card px-5 py-4 text-subhead">
          You declined this estimate. Changed your mind? Call us and we'll
          reopen it.
        </div>
      ) : null}
      {!approvable && e.status !== "declined" ? (
        <div className="card px-5 py-4 text-subhead">
          This estimate has expired. Prices may have changed — call us for an
          updated one.
        </div>
      ) : null}

      {doc.problemPhotos.length > 0 ? (
        <section aria-label="What we found" className="space-y-2">
          <h2 className="px-1 text-title3">What we found</h2>
          <PhotoGrid
            layout="strip"
            photos={doc.problemPhotos.map((p) => ({
              id: p.id,
              url: p.url,
              thumbUrl: p.thumbUrl,
              caption: p.caption,
              alt: p.caption ?? "Photo of the problem",
            }))}
          />
        </section>
      ) : null}

      {e.notes ? (
        <p className="whitespace-pre-line px-1 text-body text-label-2">
          {e.notes}
        </p>
      ) : null}

      {approvable ? (
        <EstimateApproval
          token={token}
          kind="estimate"
          number={e.number}
          options={doc.options.map((o) => ({
            id: o.id,
            label: o.label,
            recommended: o.recommended,
            notes: o.notes,
            lines: o.lines.map(toPortalLine),
            depositCents: doc.deposits[o.id]?.amountCents ?? null,
          }))}
          taxBps={doc.taxBps}
          taxExempt={doc.customer.taxExempt}
          consentText={doc.consentText}
          signerNameDefault={doc.customer.displayName}
          coolingOff={doc.coolingOff}
          present={!!presenter}
        >
          {terms}
          <PortalFooter />
        </EstimateApproval>
      ) : (
        <>
          <EstimateDocument doc={doc} showPolicies={false} />
          {terms}
        </>
      )}

      {approvable ? null : <PortalFooter />}
    </div>,
  );
}

/** /e/[token] for a change order (minted by B3 send or B5 `change_order.link`). */
async function ChangeOrderView({
  token,
  coId,
}: {
  token: string;
  coId: string;
}) {
  const [loaded, esign, sig] = await Promise.all([
    loadChangeOrder(coId),
    getCurrentPolicy("esign_consent"),
    getLatestSignature("change_order", coId),
  ]);
  if (!loaded) return <PortalExpired what="change order" />;
  const co = loaded.changeOrder;
  const open = co.status === "draft" || co.status === "sent";
  return (
    <div className="space-y-5 pt-2">
      <section className="px-1">
        <p className="num text-subhead font-semibold text-label-2">
          Change order {co.number} · Job {loaded.job.number}
        </p>
        <h1 className="mt-1 text-large-title">Additional work</h1>
        <p className="mt-1 text-body">{co.reason}</p>
        {loaded.signedTotalCents != null && open ? (
          <p className="mt-1 text-subhead text-label-2">
            You approved {formatMoney(loaded.signedTotalCents)} so far. This
            adds {formatMoney(loaded.totals.totalCents)}.
          </p>
        ) : null}
      </section>
      {co.status === "approved" ? (
        <div className="card flex flex-col items-center px-6 py-9 text-center">
          <SuccessCheck size={64} label="Approved" />
          <h2 className="mt-4 text-title2">Approved, thank you!</h2>
          {sig ? (
            <p className="mt-1 text-subhead text-label-2">
              Signed by {sig.signerName}.
            </p>
          ) : null}
        </div>
      ) : co.status === "declined" ? (
        <div className="card px-5 py-4 text-subhead">
          You declined this change. We won't do the extra work.
        </div>
      ) : (
        <EstimateApproval
          token={token}
          kind="change_order"
          number={co.number}
          options={[
            {
              id: co.id,
              label: "Additional work",
              recommended: false,
              notes: null,
              lines: loaded.lines.map(toPortalLine),
              depositCents: null,
            },
          ]}
          taxBps={loaded.taxBps}
          taxExempt={loaded.customer.taxExempt}
          consentText={esign?.body ?? DEFAULT_ESIGN_CONSENT}
          signerNameDefault={loaded.customer.displayName}
          coolingOff={false}
        >
          <PortalFooter />
        </EstimateApproval>
      )}
      {open ? null : <PortalFooter />}
    </div>
  );
}
