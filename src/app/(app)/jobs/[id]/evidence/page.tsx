import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PrintButton } from "@/features/disputes/components/PrintButton";
import {
  type EvidencePack,
  loadEvidencePack,
} from "@/features/disputes/evidence";
import { assertJobAccess } from "@/features/jobs/api";
import type { MediaItem } from "@/features/media/api";
import { FLAG_LABEL } from "@/features/media/labels";
import { requireUser } from "@/lib/auth/current";
import { formatMoney } from "@/lib/money";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { isEnabled } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Evidence pack" };

// Printable evidence pack (SPEC M10): cover + timeline → signed authorization & change
// orders → arrival/departure geostamps → before/after grid → completion sign-off →
// receipts → communications excerpt → policy excerpt → payment-auth signals.
// 12 pt+, Letter/A4, no color reliance (bold + boxes), images 1600 px, ≤ 19 pages
// (photos capped at 8 + 8, messages at 40, policy bodies trimmed).

const MAX_PHOTOS = 8;
const MAX_MESSAGES = 40;
const POLICY_CHARS = 1800;

const fmtGeo = (lat: number | null, lng: number | null) =>
  lat != null && lng != null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : "—";

function Section({
  n,
  title,
  children,
  breakBefore,
  id,
}: {
  n: number;
  title: string;
  children: ReactNode;
  breakBefore?: boolean;
  id: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-h`}
      className={`flex flex-col gap-3 ${breakBefore ? "print-section" : ""}`}
    >
      <h2
        id={`${id}-h`}
        className="border-b border-label pb-1 text-title3 font-bold"
      >
        {n}. {title}
      </h2>
      {children}
    </section>
  );
}

function Table({
  head,
  rows,
  empty,
}: {
  head: string[];
  rows: ReactNode[][];
  empty: string;
}) {
  if (rows.length === 0)
    return <p className="text-body text-label-2">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-subhead print:text-[12pt]">
        <thead>
          <tr>
            {head.map((h) => (
              <th
                key={h}
                scope="col"
                className="border-b border-label-2 py-1.5 pr-3 font-semibold"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static rows
            <tr key={i} className="align-top">
              {r.map((c, j) => (
                <td
                  // biome-ignore lint/suspicious/noArrayIndexKey: static cells
                  key={j}
                  className="border-b border-sep py-1.5 pr-3"
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PhotoGridPrint({
  title,
  photos,
  tz,
  pack,
}: {
  title: string;
  photos: MediaItem[];
  tz: string;
  pack: EvidencePack;
}) {
  if (photos.length === 0) return null;
  const shown = photos.slice(0, MAX_PHOTOS);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-headline font-semibold">
        {title} ({photos.length}
        {photos.length > MAX_PHOTOS ? `, first ${MAX_PHOTOS} shown` : ""})
      </h3>
      <div className="print-photos grid grid-cols-2 gap-3">
        {shown.map((p) => (
          <figure key={p.id} className="m-0 flex flex-col gap-1">
            <div className="relative overflow-hidden rounded-[8px] bg-fill-2">
              {/* biome-ignore lint/performance/noImgElement: signed 1600 px derivative for print */}
              <img
                src={p.url}
                alt={`${title}, ${formatDateTime(p.capturedAt ?? p.createdAt, tz)}`}
                className="aspect-[4/3] w-full object-cover"
              />
              <span className="absolute inset-x-0 bottom-0 bg-black/65 px-2 py-1 text-[11px] leading-tight text-white print:text-[9pt]">
                {formatDateTime(p.capturedAt ?? p.createdAt, tz)} · Job{" "}
                {pack.job.number}
                <br />
                {pack.job.address}
              </span>
            </div>
            <figcaption className="text-footnote text-label-2">
              GPS {fmtGeo(p.lat, p.lng)}
              {p.flags.length
                ? ` · ${p.flags.map((f) => FLAG_LABEL[f] ?? f).join(", ")}`
                : ""}
              {p.evidenceLocked ? " · locked" : ""}
              {p.caption ? ` · ${p.caption}` : ""}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function SignatureBlock({
  s,
  tz,
}: {
  s: EvidencePack["signatures"][number];
  tz: string;
}) {
  return (
    <div className="print-box flex flex-col gap-2 rounded-card border border-sep p-3 sm:flex-row">
      {s.imageUrl && (
        // biome-ignore lint/performance/noImgElement: signature image
        <img
          src={s.imageUrl}
          alt={`Signature of ${s.signerName}`}
          className="h-24 w-48 shrink-0 rounded bg-white object-contain"
        />
      )}
      <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-subhead print:text-[12pt]">
        <dt className="font-semibold">Document</dt>
        <dd>{s.docLabel}</dd>
        <dt className="font-semibold">Signed by</dt>
        <dd>{s.signerName}</dd>
        <dt className="font-semibold">When</dt>
        <dd>{formatDateTime(s.signedAt, tz)}</dd>
        <dt className="font-semibold">How</dt>
        <dd>
          {s.channel.replace("_", " ")}
          {s.esignConsent ? " · e-sign consent given" : ""}
        </dd>
        <dt className="font-semibold">Location</dt>
        <dd>
          {fmtGeo(s.lat, s.lng)}
          {s.accuracyM ? ` (±${Math.round(s.accuracyM)} m)` : ""}
        </dd>
        {s.ip && (
          <>
            <dt className="font-semibold">IP / device</dt>
            <dd className="break-all">
              {s.ip}
              {s.userAgent ? ` · ${s.userAgent.slice(0, 90)}` : ""}
            </dd>
          </>
        )}
        <dt className="font-semibold">Document hash</dt>
        <dd className="break-all font-mono text-footnote">{s.docSha256}</dd>
        {s.policies.length > 0 && (
          <>
            <dt className="font-semibold">Policies shown</dt>
            <dd>
              {s.policies.map((p) => `${p.title} v${p.version}`).join("; ")}
            </dd>
          </>
        )}
        {s.consentText && (
          <>
            <dt className="font-semibold">Consent text</dt>
            <dd>{s.consentText}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

export default async function EvidencePackPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser("evidence.view");
  if (!(await isEnabled("chargeback_protection"))) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  try {
    await assertJobAccess(user, id, "read");
  } catch {
    notFound();
  }
  const pack = await loadEvidencePack(id);
  if (!pack) notFound();
  const tz = pack.tz;
  const authSigs = pack.signatures.filter((s) => s.docType !== "completion");
  const completion = pack.signatures.filter((s) => s.docType === "completion");

  // Chronological timeline (cover page).
  const timeline: { at: Date; what: string }[] = [
    { at: pack.job.createdAt, what: "Job booked" },
    ...pack.geostamps.map((g) => ({
      at: g.at,
      what: `Status: ${g.status.replace("_", " ")}${g.lat != null ? " (geostamped)" : ""}${g.actor ? ` by ${g.actor}` : ""}`,
    })),
    ...pack.signatures.map((s) => ({
      at: s.signedAt,
      what: `${s.docLabel} signed by ${s.signerName}`,
    })),
    ...pack.payments
      .filter((p) => p.at)
      .map((p) => ({
        at: p.at as Date,
        what: `${p.kind === "deposit" ? "Deposit" : "Payment"} ${formatMoney(p.amountCents + p.tipCents)} by ${p.methodLabel}`,
      })),
    ...pack.portalLog
      .filter((l) => l.action !== "viewed")
      .map((l) => ({
        at: l.at,
        what: `Customer link: ${l.action.replace("_", " ")}`,
      })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <PageTransition>
      <NavBar
        title="Evidence pack"
        back={{ href: `/jobs/${id}`, label: "Job" }}
        trailing={<PrintButton />}
      />
      <article className="mx-auto flex w-full max-w-[860px] flex-col gap-8 bg-card px-[var(--gutter)] py-6 text-body print:max-w-none print:bg-white print:p-0 print:text-[12pt]">
        {/* 1. Cover + timeline */}
        <Section n={1} id="cover" title="Cover and timeline">
          <header className="flex flex-col gap-1">
            <p className="text-title2 font-bold">
              Evidence pack · Job {pack.job.number}
            </p>
            <p className="text-subhead text-label-2">
              {pack.company.legalName ?? pack.company.name}
              {pack.company.address ? ` · ${pack.company.address}` : ""}
              {pack.company.phone
                ? ` · ${formatPhoneDisplay(pack.company.phone)}`
                : ""}
              {pack.company.descriptor
                ? ` · statement descriptor "${pack.company.descriptor}"`
                : ""}
            </p>
            <p className="text-footnote text-label-2">
              Generated {formatDateTime(pack.generatedAt, tz)}
            </p>
          </header>
          <dl className="print-box grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-card border border-sep p-3">
            <dt className="font-semibold">Customer</dt>
            <dd>
              {pack.customer.name}
              {pack.customer.email ? ` · ${pack.customer.email}` : ""}
              {pack.customer.phone
                ? ` · ${formatPhoneDisplay(pack.customer.phone)}`
                : ""}
            </dd>
            <dt className="font-semibold">Service address</dt>
            <dd>{pack.job.address}</dd>
            <dt className="font-semibold">Service</dt>
            <dd>
              {pack.job.serviceName} · {pack.job.title}
            </dd>
            <dt className="font-semibold">Scheduled</dt>
            <dd>
              {pack.job.windowStart
                ? `${formatDateTime(pack.job.windowStart, tz)}${pack.job.windowEnd ? ` – ${formatDateTime(pack.job.windowEnd, tz)}` : ""}`
                : "—"}
            </dd>
            <dt className="font-semibold">Arrived / completed</dt>
            <dd>
              {pack.job.arrivedAt
                ? formatDateTime(pack.job.arrivedAt, tz)
                : "—"}{" "}
              /{" "}
              {pack.job.completedAt
                ? formatDateTime(pack.job.completedAt, tz)
                : "—"}
            </dd>
            <dt className="font-semibold">Technician</dt>
            <dd>
              {pack.job.techs
                .map(
                  (t) =>
                    `${t.name}${t.license ? ` (license ${t.license})` : ""}`,
                )
                .join(", ") || "—"}
            </dd>
            <dt className="font-semibold">Prior jobs</dt>
            <dd>{pack.priorJobs}</dd>
            {pack.readiness && (
              <>
                <dt className="font-semibold">Readiness score</dt>
                <dd className="print-strong">{pack.readiness.score} / 100</dd>
              </>
            )}
          </dl>
          {pack.job.serviceFeeDisclosure && (
            <p className="text-subhead">
              <strong>Service fee disclosed at booking:</strong>{" "}
              {pack.job.serviceFeeDisclosure}
            </p>
          )}
          <h3 className="text-headline font-semibold">Timeline</h3>
          <Table
            head={["When", "What"]}
            empty="No events recorded."
            rows={timeline.map((t) => [formatDateTime(t.at, tz), t.what])}
          />
        </Section>

        {/* 2. Signed authorization & change orders */}
        <Section
          n={2}
          id="auth"
          title="Signed authorization and change orders"
          breakBefore
        >
          {authSigs.length === 0 ? (
            <p className="text-label-2">
              No signed estimate or authorization on file.
            </p>
          ) : (
            authSigs.map((s) => <SignatureBlock key={s.id} s={s} tz={tz} />)
          )}
          {pack.changeOrders.length > 0 && (
            <Table
              head={["Change order", "Reason", "Change", "Status", "Signed"]}
              empty=""
              rows={pack.changeOrders.map((c) => [
                c.number,
                c.reason,
                formatMoney(c.deltaCents, { signed: true }),
                c.status,
                c.signed ? "Yes" : "No",
              ])}
            />
          )}
          {pack.deposit && (
            <p className="text-subhead">
              <strong>Deposit:</strong> {formatMoney(pack.deposit.amountCents)}{" "}
              · {pack.deposit.status}
              {pack.deposit.policyTitle
                ? ` · policy "${pack.deposit.policyTitle}" accepted`
                : ""}
              {pack.deposit.specialOrderPoAt
                ? ` · special-order part ordered ${formatDateTime(pack.deposit.specialOrderPoAt, tz)}`
                : ""}
            </p>
          )}
        </Section>

        {/* 3. Arrival & departure geostamps */}
        <Section n={3} id="geo" title="Arrival and departure geostamps">
          <Table
            head={["Status", "Time", "Location", "Accuracy", "From site"]}
            empty="No status events with a location."
            rows={pack.geostamps.map((g) => [
              g.status.replace("_", " "),
              formatDateTime(g.at, tz),
              fmtGeo(g.lat, g.lng),
              g.accuracyM != null ? `±${Math.round(g.accuracyM)} m` : "—",
              g.distanceM != null ? `${Math.round(g.distanceM)} m` : "—",
            ])}
          />
        </Section>

        {/* 4. Before / after photos */}
        <Section n={4} id="photos" title="Before and after photos" breakBefore>
          {pack.photos.before.length + pack.photos.after.length === 0 ? (
            <p className="text-label-2">No before/after photos on this job.</p>
          ) : (
            <>
              <p className="text-footnote text-label-2">
                Photos are hashed (SHA-256) at capture, stamped with the device
                time and GPS, and stored unaltered. Times are{" "}
                {tz.replace("_", " ")}.
              </p>
              <PhotoGridPrint
                title="Before"
                photos={pack.photos.before}
                tz={tz}
                pack={pack}
              />
              <PhotoGridPrint
                title="After"
                photos={pack.photos.after}
                tz={tz}
                pack={pack}
              />
            </>
          )}
        </Section>

        {/* 5. Completion sign-off */}
        <Section n={5} id="completion" title="Completion sign-off" breakBefore>
          {completion.length === 0 ? (
            <p className="text-label-2">No completion signature on file.</p>
          ) : (
            completion.map((s) => <SignatureBlock key={s.id} s={s} tz={tz} />)
          )}
        </Section>

        {/* 6. Receipts */}
        <Section n={6} id="receipts" title="Invoice and receipts">
          {pack.invoice ? (
            <>
              <p className="text-subhead">
                <strong>Invoice {pack.invoice.number}</strong> ·{" "}
                {pack.invoice.status}
                {pack.invoice.issuedAt
                  ? ` · issued ${formatDateTime(pack.invoice.issuedAt, tz)}`
                  : ""}
              </p>
              <Table
                head={["Item", "Qty", "Unit", "Total"]}
                empty=""
                rows={[
                  ...pack.invoice.lines.map((l) => [
                    l.name,
                    String(l.qty),
                    formatMoney(l.unitCents),
                    formatMoney(l.totalCents),
                  ]),
                  ["Tax", "", "", formatMoney(pack.invoice.taxCents)],
                  [
                    <strong key="t">Total</strong>,
                    "",
                    "",
                    <strong key="v">
                      {formatMoney(pack.invoice.totalCents)}
                    </strong>,
                  ],
                ]}
              />
            </>
          ) : (
            <p className="text-label-2">No invoice.</p>
          )}
          <Table
            head={["Paid", "Amount", "Method", "Status", "Reference"]}
            empty="No payments."
            rows={pack.payments.map((p) => [
              p.at ? formatDateTime(p.at, tz) : "—",
              `${formatMoney(p.amountCents)}${p.tipCents ? ` + ${formatMoney(p.tipCents)} tip` : ""}`,
              p.methodLabel,
              `${p.status}${p.refundedCents ? ` (${formatMoney(p.refundedCents)} refunded)` : ""}`,
              p.reference ?? p.providerRef ?? "—",
            ])}
          />
        </Section>

        {/* 7. Communications */}
        <Section n={7} id="comms" title="Communications excerpt" breakBefore>
          <Table
            head={["When", "Direction", "Channel", "Message"]}
            empty="No messages logged on this job."
            rows={pack.messages
              .slice(0, MAX_MESSAGES)
              .map((m) => [
                formatDateTime(m.at, tz),
                m.direction === "in" ? "From customer" : "To customer",
                `${m.channel} · ${m.status.replace("_", " ")}`,
                m.body.length > 320 ? `${m.body.slice(0, 320)}…` : m.body,
              ])}
          />
          {pack.messages.length > MAX_MESSAGES && (
            <p className="text-footnote text-label-2">
              {pack.messages.length - MAX_MESSAGES} more messages not shown.
            </p>
          )}
        </Section>

        {/* 8. Policies */}
        <Section n={8} id="policies" title="Policy excerpt">
          {pack.policies.length === 0 ? (
            <p className="text-label-2">
              No policies were attached to this job.
            </p>
          ) : (
            pack.policies.map((p) => (
              <div key={p.id} className="flex flex-col gap-1">
                <h3 className="text-headline font-semibold">
                  {p.title} (version {p.version})
                </h3>
                <p className="break-all font-mono text-footnote text-label-2">
                  SHA-256 {p.sha256}
                </p>
                <p className="whitespace-pre-line text-subhead print:text-[12pt]">
                  {p.body.length > POLICY_CHARS
                    ? `${p.body.slice(0, POLICY_CHARS)}…`
                    : p.body}
                </p>
              </div>
            ))
          )}
        </Section>

        {/* 9. Payment-auth signals */}
        <Section
          n={9}
          id="auth-signals"
          title="Payment authorization signals"
          breakBefore
        >
          <Table
            head={[
              "Payment",
              "Entry",
              "Card",
              "AVS / CVC",
              "3-D Secure",
              "Wallet",
            ]}
            empty="No card payments."
            rows={pack.payments
              .filter((p) => p.method === "card")
              .map((p) => [
                `${formatMoney(p.amountCents)} ${p.at ? formatDateTime(p.at, tz) : ""}`,
                p.entryMode ?? "—",
                `${p.brand ?? ""} ${p.funding ?? ""} ${p.last4 ? `••${p.last4}` : ""}`.trim() ||
                  "—",
                [p.avs, p.cvc].filter(Boolean).join(" / ") || "—",
                p.threeDs ?? "—",
                p.wallet ?? "—",
              ])}
          />
          <h3 className="text-headline font-semibold">
            Customer link activity
          </h3>
          <Table
            head={["When", "Action", "Page", "IP / device"]}
            empty="No customer link activity."
            rows={pack.portalLog
              .slice(0, 30)
              .map((l) => [
                formatDateTime(l.at, tz),
                l.action.replace("_", " "),
                l.path,
                `${l.ip ?? "—"}${l.userAgent ? ` · ${l.userAgent.slice(0, 60)}` : ""}`,
              ])}
          />
        </Section>
      </article>
    </PageTransition>
  );
}
