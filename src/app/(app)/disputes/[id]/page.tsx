import { FileText, Printer } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasCardProcessor } from "@/adapters/payments";
import { CustomerCard } from "@/features/customers/slots";
import {
  DisputeEditor,
  type EditorMedia,
} from "@/features/disputes/components/DisputeEditor";
import { loadEvidencePack } from "@/features/disputes/evidence";
import {
  DISPUTE_CATEGORY_LABELS,
  type DisputeCategory,
  EVIDENCE_FILE_FIELDS,
  EVIDENCE_TEXT_FIELDS,
  relevantTextFields,
  suggestAccept,
} from "@/features/disputes/narrative";
import { getDisputeDetail } from "@/features/disputes/queries";
import { requireUser } from "@/lib/auth/current";
import { formatMoney } from "@/lib/money";
import { getCompanyTimezone, getSettings, isEnabled } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { KeyValueList } from "@/ui/components/KeyValueList";
import { MoneyText } from "@/ui/components/MoneyText";
import { NavBar } from "@/ui/components/NavBar";
import { ReadinessRing } from "@/ui/components/Score";
import { StatusPill } from "@/ui/components/StatusPill";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Dispute" };

const OPEN = ["inquiry", "needs_response", "under_review"];

// /disputes/[id] (SPEC M10): review the template narrative and evidence mapped to the
// processor's fields, attach/remove files, then Submit or Accept. Without a processor
// connection the page offers the printable pack plus a field-by-field copy panel.
export default async function DisputeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser("disputes.view");
  if (!(await isEnabled("chargeback_protection"))) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const r = await getDisputeDetail(id);
  if (!r) notFound();
  const { d, p } = r;
  const [tz, s, pack] = await Promise.all([
    getCompanyTimezone(),
    getSettings(),
    p.jobId ? loadEvidencePack(p.jobId) : null,
  ]);
  const category = d.category as DisputeCategory;
  const evidence = (d.evidence ?? {}) as Record<string, unknown>;
  const relevant = new Set(relevantTextFields(category));
  const open = OPEN.includes(d.status);
  const editable = open && !d.submittedAt && user.perms.has("disputes.manage");
  const readinessNow = pack?.readiness?.score ?? r.jobReadiness ?? null;
  const hoursLeft = d.dueBy
    ? Math.round((d.dueBy.getTime() - Date.now()) / 3_600_000)
    : null;
  const media: EditorMedia[] = pack
    ? [
        ...pack.signatures
          .filter((x) => x.mediaId && x.imageUrl)
          .map((x) => ({
            id: x.mediaId as string,
            thumbUrl: x.imageUrl as string,
            label: `Signature · ${x.docLabel}`,
          })),
        ...pack.photos.before.map((m) => ({
          id: m.id,
          thumbUrl: m.thumbUrl,
          label: "Before photo",
        })),
        ...pack.photos.after.map((m) => ({
          id: m.id,
          thumbUrl: m.thumbUrl,
          label: "After photo",
        })),
        ...pack.photos.other.map((m) => ({
          id: m.id,
          thumbUrl: m.thumbUrl,
          label: m.tag ? `${m.tag} photo` : "Photo",
        })),
      ]
    : [];

  return (
    <PageTransition>
      <NavBar
        title="Dispute"
        back={{ href: "/disputes", label: "Disputes" }}
        trailing={
          p.jobId && user.perms.has("evidence.view") ? (
            <Button
              size="sm"
              variant="plain"
              icon={<Printer size={17} />}
              href={`/jobs/${p.jobId}/evidence`}
            >
              Pack
            </Button>
          ) : undefined
        }
      />
      <Page className="flex flex-col gap-[var(--section-gap)] pt-4">
        <section className="flex flex-col items-center gap-2 rounded-card bg-card p-5 text-center">
          <StatusPill kind="dispute" status={d.status} />
          <p className="num text-large-title font-bold">
            <MoneyText cents={d.amountCents} />
          </p>
          <p className="text-subhead text-label-2">
            {DISPUTE_CATEGORY_LABELS[category] ?? d.category}
            {d.networkReasonCode ? ` · code ${d.networkReasonCode}` : ""}
          </p>
          {open && d.dueBy && (
            <p
              className={
                hoursLeft != null && hoursLeft < 72
                  ? "text-headline text-danger"
                  : "text-headline"
              }
            >
              {hoursLeft != null && hoursLeft < 0
                ? "Response deadline passed"
                : `Respond by ${formatDateTime(d.dueBy, tz)}`}
            </p>
          )}
        </section>

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
          <div className="flex flex-col gap-[var(--section-gap)]">
            {d.submittedAt && open && (
              <Banner tone="info" title="Evidence submitted">
                Submitted {formatDateTime(d.submittedAt, tz)}. The card network
                usually decides within 60–75 days.
              </Banner>
            )}
            {!open && (
              <Banner
                tone={d.status === "won" ? "success" : "warning"}
                title={
                  d.status === "won"
                    ? "Won: the money stays with you"
                    : d.status === "lost"
                      ? "Lost: the amount was returned to the customer"
                      : "Closed"
                }
              >
                {d.closedAt
                  ? `Closed ${formatDateTime(d.closedAt, tz)}.`
                  : null}
              </Banner>
            )}
            {!p.jobId && (
              <Banner tone="warning">
                This payment isn't linked to a job, so there's no job evidence
                to attach.
              </Banner>
            )}
            <DisputeEditor
              disputeId={d.id}
              editable={editable}
              hasApi={d.provider === "stripe" && hasCardProcessor()}
              amountLabel={formatMoney(d.amountCents)}
              suggestAccept={
                open &&
                !d.submittedAt &&
                suggestAccept({
                  amountCents: d.amountCents,
                  readiness: readinessNow,
                  underCents: s.disputes.suggest_accept_under_cents,
                  readinessBelow: s.disputes.suggest_accept_readiness_below,
                })
              }
              narrative={
                d.narrative ??
                (typeof evidence.uncategorized_text === "string"
                  ? evidence.uncategorized_text
                  : "")
              }
              fields={EVIDENCE_TEXT_FIELDS.map((f) => ({
                key: f.key,
                label: f.label,
                multiline: f.multiline,
                relevant: relevant.has(f.key),
                value:
                  typeof evidence[f.key] === "string"
                    ? (evidence[f.key] as string)
                    : "",
              }))}
              files={EVIDENCE_FILE_FIELDS.map((f) => ({
                key: f.key,
                label: f.label,
                mediaId: d.evidenceFiles?.[f.key]?.media_id ?? null,
              }))}
              media={media}
            />
          </div>
          <aside className="mt-[var(--section-gap)] flex flex-col gap-[var(--section-gap)] lg:mt-0">
            <CustomerCard
              customerId={p.customerId}
              jobId={p.jobId ?? undefined}
              variant="compact"
            />
            <section className="flex items-center gap-4 rounded-card bg-card p-4">
              <ReadinessRing score={readinessNow} size={52} />
              <div className="min-w-0">
                <p className="text-headline">Evidence readiness</p>
                <p className="text-footnote text-label-2">
                  {d.readinessAtOpen != null
                    ? `${d.readinessAtOpen} when the dispute opened`
                    : "Not recorded at open"}
                </p>
              </div>
            </section>
            <KeyValueList
              items={[
                {
                  label: "Payment",
                  value: `${p.cardBrand ? `${p.cardBrand.toUpperCase()} ` : ""}${p.cardLast4 ? `••${p.cardLast4}` : p.method}`,
                },
                {
                  label: "Charged",
                  value: p.succeededAt
                    ? formatDateTime(p.succeededAt, tz)
                    : null,
                },
                { label: "Entry", value: p.entryMode },
                { label: "3-D Secure", value: p.threeDs },
                {
                  label: "AVS / CVC",
                  value: [p.avsResult, p.cvcResult].filter(Boolean).join(" / "),
                },
                {
                  label: "Job",
                  value: r.jobNumber
                    ? `${r.jobNumber}${r.jobTitle ? ` · ${r.jobTitle}` : ""}`
                    : null,
                  href: p.jobId ? `/jobs/${p.jobId}` : undefined,
                },
                { label: "Processor ref", value: d.providerRef },
              ]}
            />
            {p.jobId && user.perms.has("evidence.view") && (
              <Button
                variant="gray"
                icon={<FileText size={18} />}
                href={`/jobs/${p.jobId}/evidence`}
              >
                Open printable evidence pack
              </Button>
            )}
          </aside>
        </div>
      </Page>
    </PageTransition>
  );
}
