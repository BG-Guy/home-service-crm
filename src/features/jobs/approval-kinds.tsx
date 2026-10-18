// Approval kinds produced by `jobs` (BUILD_PLAN §6.10). Owner: B2.
// job_cancel: after-arrival cancellations (decided by jobs.review_cancellations → ok/flagged).
// job_start: Critical-risk start requests (decided by jobs.approve_start → emits start_approved/denied).
import "server-only";
import { eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { db, type Tx } from "@/db";
import { customers, jobs, media, users } from "@/db/schema";
import type {
  ApprovalDecision,
  ApprovalKindDef,
  ApprovalRow,
} from "@/features/approvals/contracts";
import { getMediaUrls } from "@/features/media/api";
import { writeActivity } from "@/lib/activity";
import { emit } from "@/lib/events";
import { getCompanyTimezone } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import type { Actor } from "@/lib/types";
import { KeyValueList } from "@/ui/components/KeyValueList";
import { RiskChip } from "@/ui/components/Score";
import { jobRef } from "./internal";
import { CANCEL_REASON_LABEL } from "./machine";

async function jobBrief(jobId: string) {
  const [r] = await db
    .select({
      number: jobs.number,
      title: jobs.title,
      customerId: jobs.customerId,
      customerName: customers.displayName,
      arrivedAt: jobs.arrivedAt,
      cancelReason: jobs.cancelReason,
      cancelNote: jobs.cancelNote,
      riskScore: jobs.riskScore,
      riskBand: jobs.riskBand,
    })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .where(eq(jobs.id, jobId))
    .limit(1);
  return r ?? null;
}

async function requesterName(id: string | null): Promise<string | null> {
  if (!id) return null;
  const [u] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return u?.name ?? null;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v ? v : null;
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

async function evidencePhotos(
  a: ApprovalRow,
): Promise<{ id: string; url: string }[]> {
  const ev = a.evidence ?? {};
  let ids = strs(ev.photo_media_ids);
  const clientIds = strs(ev.photo_client_ids);
  if (clientIds.length) {
    const rows = await db
      .select({ id: media.id })
      .from(media)
      .where(inArray(media.clientId, clientIds));
    ids = [...new Set([...ids, ...rows.map((r) => r.id)])];
  }
  if (!ids.length) return [];
  const urls = await getMediaUrls(ids, "thumb").catch(
    () => ({}) as Record<string, string>,
  );
  return ids
    .filter((id) => urls[id])
    .map((id) => ({ id, url: urls[id] as string }));
}

const jobCancel: ApprovalKindDef = {
  entityTypes: ["job_cancel"],
  perm: "jobs.review_cancellations",
  label: "After-arrival cancellations",
  async Row({ approval }) {
    const j = await jobBrief(approval.entityId);
    const by = await requesterName(approval.requestedBy);
    return (
      <span>
        {j?.number ?? "Job"} cancelled after arrival
        {j?.cancelReason
          ? ` · ${CANCEL_REASON_LABEL[j.cancelReason] ?? j.cancelReason}`
          : ""}
        {by ? ` · ${by}` : ""}
      </span>
    );
  },
  async Detail({ approval }) {
    const j = await jobBrief(approval.entityId);
    const tz = await getCompanyTimezone();
    const photos = await evidencePhotos(approval);
    const ev = approval.evidence ?? {};
    return (
      <div className="flex flex-col gap-3">
        <KeyValueList
          items={[
            {
              label: "Job",
              value: j ? `${j.number} · ${j.title}` : "—",
              href: `/jobs/${approval.entityId}`,
            },
            { label: "Customer", value: j?.customerName },
            {
              label: "Requested by",
              value: await requesterName(approval.requestedBy),
            },
            {
              label: "Arrived",
              value: j?.arrivedAt ? formatDateTime(j.arrivedAt, tz) : null,
            },
            {
              label: "Reason",
              value:
                CANCEL_REASON_LABEL[str(ev.reason) ?? j?.cancelReason ?? ""] ??
                str(ev.reason),
            },
            {
              label: "Note",
              value: str(ev.note) ?? j?.cancelNote,
              stacked: true,
            },
          ]}
        />
        {photos.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p) => (
              // biome-ignore lint/performance/noImgElement: signed thumbnail URLs (SPEC §14.7)
              <img
                key={p.id}
                src={p.url}
                alt="Cancellation evidence"
                loading="lazy"
                decoding="async"
                className="aspect-square w-full rounded-control object-cover"
              />
            ))}
          </div>
        ) : (
          <p className="text-footnote text-label-2">
            Photo still uploading from the tech's phone.
          </p>
        )}
        <p className="text-footnote text-label-2">
          Approve marks the cancellation OK. Reject flags it for the weekly
          anomaly report.
        </p>
      </div>
    );
  },
  clean(a) {
    return (
      strs(a.evidence?.photo_client_ids).length > 0 && !!str(a.evidence?.note)
    );
  },
  async onDecide(
    tx: Tx,
    approval: ApprovalRow,
    d: ApprovalDecision,
    actor: Actor,
  ) {
    const [j] = await tx
      .select({ customerId: jobs.customerId, number: jobs.number })
      .from(jobs)
      .where(eq(jobs.id, approval.entityId))
      .limit(1);
    if (!j) return;
    const status = d.decision === "approved" ? "ok" : "flagged";
    await tx
      .update(jobs)
      .set({ cancelReviewStatus: status, updatedAt: new Date() })
      .where(eq(jobs.id, approval.entityId));
    await writeActivity(tx, {
      entity: jobRef(approval.entityId),
      customerId: j.customerId,
      kind: "job.cancel_reviewed",
      summary:
        status === "ok"
          ? "After-arrival cancellation reviewed: OK"
          : `After-arrival cancellation flagged${d.reason ? `: ${d.reason}` : ""}`,
      actorUserId: actor.userId,
    });
  },
};

const jobStart: ApprovalKindDef = {
  entityTypes: ["job_start"],
  perm: "jobs.approve_start",
  label: "Critical-risk job starts",
  async Row({ approval }) {
    const j = await jobBrief(approval.entityId);
    const by = await requesterName(approval.requestedBy);
    return (
      <span>
        Start {j?.number ?? "job"} (Critical risk
        {j?.riskScore != null ? ` ${j.riskScore}` : ""}){by ? ` · ${by}` : ""}
      </span>
    );
  },
  async Detail({ approval }) {
    const j = await jobBrief(approval.entityId);
    const ev = approval.evidence ?? {};
    const signals = Array.isArray(ev.signals)
      ? (ev.signals as { key?: string; points?: number; detail?: string }[])
      : [];
    return (
      <div className="flex flex-col gap-3">
        <KeyValueList
          items={[
            {
              label: "Job",
              value: j ? `${j.number} · ${j.title}` : "—",
              href: `/jobs/${approval.entityId}`,
            },
            { label: "Customer", value: j?.customerName },
            {
              label: "Requested by",
              value: await requesterName(approval.requestedBy),
            },
            {
              label: "Risk",
              value: j?.riskBand ? (
                <RiskChip
                  band={j.riskBand as "critical"}
                  score={j.riskScore ?? undefined}
                />
              ) : null,
            },
            { label: "Tech's note", value: str(ev.note), stacked: true },
          ]}
        />
        {signals.length > 0 && (
          <ul className="list-card">
            {signals.map((s) => (
              <li
                key={s.key}
                className="list-row flex min-h-11 items-center justify-between gap-3 px-4 py-2"
              >
                <span className="text-subhead">{s.detail ?? s.key}</span>
                <span className="num text-subhead text-label-2">
                  +{s.points ?? 0}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-footnote text-label-2">
          Approving lets the tech start now. Denying asks them to collect
          prepayment (or cash/ACH) first.{" "}
          <Link
            className="text-accent-text"
            href={`/jobs/${approval.entityId}?tab=history`}
          >
            History
          </Link>
        </p>
      </div>
    );
  },
  async onDecide(
    tx: Tx,
    approval: ApprovalRow,
    d: ApprovalDecision,
    actor: Actor,
  ) {
    const [j] = await tx
      .select({ customerId: jobs.customerId })
      .from(jobs)
      .where(eq(jobs.id, approval.entityId))
      .limit(1);
    if (!j) return;
    const approved = d.decision === "approved";
    await emit(
      tx,
      approved ? "job.start_approved" : "job.start_denied",
      jobRef(approval.entityId),
      { job_id: approval.entityId, approval_id: approval.id },
      { actor },
    );
    await writeActivity(tx, {
      entity: jobRef(approval.entityId),
      customerId: j.customerId,
      kind: approved ? "job.start_approved" : "job.start_denied",
      summary: approved
        ? "Admin approved starting the job"
        : `Admin denied starting the job${d.reason ? `: ${d.reason}` : ""}`,
      actorUserId: actor.userId,
    });
  },
};

export const approvalKinds: ApprovalKindDef[] = [jobCancel, jobStart];
