import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { formatDateTime, formatTime } from "@/lib/time";
import type { EstimateSignatureView } from "../doc";

// The top of an approved estimate (Quote to Paid E5): a success header (check,
// "Approved · Better · $450.73", who signed and when), the signature image, the
// link strip EST → job → invoice, and the evidence line (fingerprint, policies,
// IP, location). Server-rendered, zero JS.

const CHANNEL: Record<string, string> = {
  in_person: "signed in person",
  remote_link: "signed online",
  verbal: "verbal approval",
};

const chip =
  "inline-flex items-center gap-1 rounded-pill bg-card px-3 py-1 font-semibold shadow-card";

/** EST-1026 → J-1079 → INV-1067: the estimate, its job and the job's invoice. */
export function DocLinkStrip({
  number,
  approved,
  job,
  invoice,
  className,
}: {
  number: string;
  approved?: boolean;
  job: { id: string; number: string } | null;
  invoice: { id: string; number: string } | null;
  className?: string;
}) {
  return (
    <nav
      aria-label="Estimate, job and invoice"
      className={`flex flex-wrap items-center gap-1.5 text-subhead ${className ?? ""}`}
    >
      <span
        className={approved ? `${chip} text-success` : chip}
        style={
          approved
            ? {
                background:
                  "color-mix(in srgb, var(--sys-green) var(--tint-a), var(--card))",
              }
            : undefined
        }
      >
        {approved ? <Check size={14} strokeWidth={3} aria-hidden /> : null}
        {number}
      </span>
      {job ? (
        <>
          <ArrowRight size={14} aria-hidden className="text-label-3" />
          <Link href={`/jobs/${job.id}`} className={chip}>
            {job.number}
          </Link>
        </>
      ) : null}
      {invoice ? (
        <>
          <ArrowRight size={14} aria-hidden className="text-label-3" />
          <Link href={`/invoices/${invoice.id}`} className={chip}>
            {invoice.number}
          </Link>
        </>
      ) : null}
    </nav>
  );
}

export function ApprovedSummary({
  number,
  optionLabel,
  multi,
  totalCents,
  signature,
  policyVersions,
  timezone,
  job,
  invoice,
}: {
  number: string;
  optionLabel: string;
  multi: boolean;
  totalCents: number;
  signature: EstimateSignatureView | null;
  policyVersions: number[];
  timezone: string;
  job: { id: string; number: string } | null;
  invoice: { id: string; number: string } | null;
}) {
  return (
    <section
      aria-label="Approved"
      className="flex flex-col items-center rounded-card bg-card px-5 pb-5 pt-6 text-center shadow-card"
    >
      <span
        aria-hidden
        className="flex size-16 items-center justify-center rounded-full text-white"
        style={{
          background: "linear-gradient(145deg, #34c759, #23863c)",
          boxShadow: "0 10px 28px -10px #23863c",
        }}
      >
        <Check size={34} strokeWidth={3} />
      </span>
      <h2 className="mt-3 text-title1 font-bold">Approved</h2>
      <p className="num text-subhead text-label-2">
        {[
          multi ? optionLabel : null,
          formatMoney(totalCents),
          signature
            ? `signed ${formatTime(signature.signedAt, timezone)}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {signature ? (
        <p className="text-subhead text-label-2">
          {signature.signerName} ·{" "}
          {CHANNEL[signature.channel] ?? signature.channel}
        </p>
      ) : null}
      {signature?.imageUrl ? (
        // biome-ignore lint/performance/noImgElement: signed storage URL
        <img
          src={signature.imageUrl}
          alt={`Signature of ${signature.signerName}`}
          className="mt-3 h-16 w-auto max-w-60 rounded-lg bg-white object-contain px-3 py-1"
        />
      ) : null}
      <DocLinkStrip
        number={number}
        approved
        job={job}
        invoice={invoice}
        className="mt-4 justify-center"
      />
      {signature ? (
        <p className="mt-4 text-caption text-label-3 [overflow-wrap:anywhere]">
          {[
            formatDateTime(signature.signedAt, timezone),
            signature.ip ? `IP ${signature.ip}` : null,
            signature.lat != null ? "location captured" : null,
            `fingerprint SHA-256 ${signature.docSha256.slice(0, 16)}…`,
            policyVersions.length
              ? `policies v${policyVersions.join("/")}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
    </section>
  );
}
