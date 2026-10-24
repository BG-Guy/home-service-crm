import { and, desc, eq, inArray } from "drizzle-orm";
import { ChevronDown, Eye } from "lucide-react";
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
import { EstimatePhotos } from "@/features/estimates/components/EstimatePhotos";
import { type EstimateDoc, loadEstimateDoc } from "@/features/estimates/doc";
import { canApproveEstimate } from "@/features/estimates/logic";
import type { DocLineType } from "@/features/invoices/math";
import { TAG_LABEL } from "@/features/media/labels";
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
import { type Presenter, presentingUser } from "@/features/portal/present";
import {
  openPortalToken,
  peekPublicToken,
  portalActor,
} from "@/features/portal/token";
import { getLatestSignature } from "@/features/signatures/api";
import { formatMoney } from "@/lib/money";
import { getCurrentPolicy } from "@/lib/policies";
import { stageStyle } from "@/lib/stage-colors";
import { formatDate, formatDateTime } from "@/lib/time";
import type { PublicTokenRow } from "@/lib/tokens";
import { Button } from "@/ui/components/Button";
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

/** An estimate photo's label: its caption, else its tag (Problem / Goal). */
const photoLabel = (p: { caption: string | null; tag: string | null }) =>
  p.caption?.trim() ||
  (p.tag ? TAG_LABEL[p.tag as keyof typeof TAG_LABEL] : null) ||
  "Photo";

// /e/[token] (SPEC M07, M23; Quote to Paid E4): one option per screen, then the
// one-step signature (consent, name, pad), then the deposit (B4 /p/). Every
// customer hit is logged (portal_access_log); the first view flips sent → viewed.
// `?present=1` with a signed-in staff user who may present it: the same page full
// screen on the staff device (present mode); the approval is then recorded as
// signed in person. Staff never count as the customer: no access-log row, no
// "viewed", no alert. `&preview=1`: the builder's Preview, Approve / Decline off.
export default async function ETokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ present?: string; preview?: string }>;
}) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  // The presenter is checked BEFORE the token is opened: opening logs a view.
  let tok: PublicTokenRow | null = null;
  let presenter: Presenter | null = null;
  if (sp.present === "1") {
    const peek = await peekPublicToken(["estimate"], token);
    if (peek?.entityType === "estimate") {
      presenter = await presentingUser(peek.entityId);
      if (presenter) tok = peek;
    }
  }
  tok ??= await openPortalToken("estimate", token, "/e/[token]");
  if (!tok) return <PortalExpired what="estimate link" />;
  if (tok.entityType === "change_order")
    return <ChangeOrderView token={token} coId={tok.entityId} />;
  if (tok.entityType !== "estimate") return <PortalExpired />;
  if (!presenter) {
    const row = tok;
    const actor = await portalActor(row);
    await db
      .transaction((tx) => markEstimateViewed(tx, row.entityId, row.id, actor))
      .catch(() => false);
  }
  const doc = await loadEstimateDoc(tok.entityId);
  if (!doc) return <PortalExpired what="estimate" />;
  const e = doc.estimate;
  const tz = doc.timezone;
  const first =
    doc.customer.firstName ?? doc.customer.displayName.split(" ")[0] ?? "there";
  const preview = !!presenter && sp.preview === "1";
  // Present mode wraps every state of the page (it stays mounted when the
  // approval refreshes it into "Approved").
  const present = (node: ReactNode) => {
    const page = <div style={stageStyle("estimate")}>{node}</div>;
    return presenter ? (
      <LazyPresentMode
        exitHref={`/estimates/${e.id}`}
        company={doc.company.name}
        heading={`Estimate ${e.number}`}
        customer={first}
        stage={e.status}
        preview={preview}
      >
        {page}
      </LazyPresentMode>
    ) : (
      page
    );
  };

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
  const firstPhoto = doc.problemPhotos[0];
  return present(
    <div className="space-y-5 pt-2">
      {preview ? (
        <p className="flex items-center gap-2 rounded-tile bg-[color-mix(in_srgb,var(--accent)_var(--tint-a),transparent)] px-4 py-3 text-subhead font-semibold text-[var(--ink-accent)]">
          <Eye size={18} aria-hidden className="shrink-0" />
          Preview: this is what {first} sees. Approve and Decline are off.
        </p>
      ) : null}
      <Hero doc={doc} first={first} approvable={approvable} />

      {e.status === "declined" ? (
        <div className="card px-5 py-4 text-subhead">
          You declined this estimate. Changed your mind? Call us and we'll
          reopen it.
        </div>
      ) : e.status === "superseded" ? (
        <div className="card px-5 py-4 text-subhead">
          This estimate was replaced by a newer one. Call us and we'll send you
          the current one.
        </div>
      ) : !approvable ? (
        <div className="card px-5 py-4 text-subhead">
          This estimate has expired. Prices may have changed — call us for an
          updated one.
        </div>
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
          preview={preview}
          photo={
            firstPhoto
              ? { url: firstPhoto.url, label: photoLabel(firstPhoto) }
              : null
          }
        >
          {e.notes ? (
            <p className="whitespace-pre-line px-1 text-body text-label-2">
              {e.notes}
            </p>
          ) : null}
          <EstimatePhotos photos={doc.problemPhotos} />
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

/** The estimate's hero in the stage color: who it's for, what, until when. */
function Hero({
  doc,
  first,
  approvable,
}: {
  doc: EstimateDoc;
  first: string;
  approvable: boolean;
}) {
  const e = doc.estimate;
  const n = doc.options.length;
  const lead =
    n > 1
      ? `Hi ${first}, here are ${n === 2 ? "two" : "three"} ways to do it`
      : `Hi ${first}, here's your estimate`;
  return (
    <section
      className="rounded-[24px] px-5 pb-5 pt-4 text-white shadow-card"
      style={{
        background:
          "linear-gradient(150deg, var(--accent-fill), color-mix(in srgb, var(--accent-fill) 78%, #1e1b4b))",
      }}
    >
      <p className="num text-footnote font-semibold text-white/80">
        Estimate {e.number}
      </p>
      <p className="mt-2 text-subhead text-white/90">{lead}</p>
      <h1 className="mt-0.5 text-title2 font-bold">
        {e.title ?? doc.company.name}
      </h1>
      <p className="mt-1.5 text-footnote text-white/85">
        {[
          doc.preparedBy ? `From ${doc.preparedBy}` : null,
          doc.propertyLines[0] ?? null,
          e.expiresAt
            ? approvable
              ? `Valid until ${formatDate(e.expiresAt, doc.timezone)}`
              : `Expired ${formatDate(e.expiresAt, doc.timezone)}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </section>
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
    <div className="space-y-5 pt-2" style={stageStyle("estimate")}>
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
