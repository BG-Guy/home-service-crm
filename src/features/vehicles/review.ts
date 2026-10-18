import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  fuelLogs,
  inspections,
  media,
  odometerReadings,
  serviceRecords,
  trips,
  users,
  vehicleDocuments,
  vehicles,
} from "@/db/schema";
import type { ApprovalRow } from "@/features/approvals/contracts";
import { getMediaUrls } from "@/features/media/api";
import { getCompanyTimezone } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import { aiTaskForMedia, LOG_LABEL } from "./engine";
import {
  ANOMALY_LABELS,
  INSPECTION_ITEMS,
  MISSING_LABELS,
  taskLabel,
  type VehicleLogType,
} from "./rules";

// Review-item loader shared by the approval kinds (Row/Detail) and /vehicles/approvals.
// Reads LIVE values from the log tables (the approval's evidence is a snapshot).

export interface ReviewField {
  label: string;
  typed: string;
  ai?: string | null;
  /** AI disagrees with the typed value. */
  mismatch?: boolean;
}

export interface ReviewItem {
  approvalId: string;
  type: VehicleLogType;
  entityId: string;
  vehicleId: string | null;
  vehicleName: string;
  submittedBy: string | null;
  /** Formatted in the company time zone. */
  submittedAt: string;
  headline: string;
  fields: ReviewField[];
  aiConfidence: number | null;
  aiStatus: "none" | "pending" | "done" | "skipped";
  previous: string | null;
  flags: { code: string; label: string }[];
  missing: { code: string; label: string }[];
  images: { id: string; url: string; thumbUrl: string; pdf: boolean }[];
  clean: boolean;
  /** Fields an "Edit and approve" may change. */
  editable: (
    | "value"
    | "gallons"
    | "totalCents"
    | "odometer"
    | "costCents"
    | "expiresOn"
    | "miles"
  )[];
  current: Record<string, number | string | null>;
}

const num = new Intl.NumberFormat("en-US");
const usd = (c: number | null | undefined) =>
  c == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(c / 100);

async function mediaList(ids: string[]) {
  const list = [...new Set(ids.filter(Boolean))];
  if (list.length === 0) return [];
  const [full, thumb, rows] = await Promise.all([
    getMediaUrls(list, "full"),
    getMediaUrls(list, "thumb"),
    db
      .select({ id: media.id, mime: media.mime })
      .from(media)
      .where(inArray(media.id, list)),
  ]);
  const mime = new Map(rows.map((r) => [r.id, r.mime]));
  return list
    .filter((id) => full[id])
    .map((id) => ({
      id,
      url: full[id] as string,
      thumbUrl: thumb[id] ?? (full[id] as string),
      pdf: mime.get(id) === "application/pdf",
    }));
}

export async function loadReviewItem(
  a: ApprovalRow,
): Promise<ReviewItem | null> {
  const type = a.entityType as VehicleLogType;
  const ev = (a.evidence ?? {}) as {
    flags?: string[];
    missing?: string[];
    previous?: { value: number; at: string } | null;
    vehicle_id?: string;
    vehicle?: string;
    awaiting_ai?: boolean;
  };
  let vehicleId: string | null = ev.vehicle_id ?? null;
  const fields: ReviewField[] = [];
  let mediaIds: string[] = [];
  let flags: string[] = ev.flags ?? [];
  let headline = LOG_LABEL[type] ?? type;
  let aiConfidence: number | null = null;
  let aiStatus: ReviewItem["aiStatus"] = "none";
  let editable: ReviewItem["editable"] = [];
  let current: ReviewItem["current"] = {};

  switch (type) {
    case "odometer": {
      const [r] = await db
        .select()
        .from(odometerReadings)
        .where(eq(odometerReadings.id, a.entityId))
        .limit(1);
      if (!r) return null;
      vehicleId = r.vehicleId;
      flags = r.flags;
      headline = `Odometer ${num.format(r.value)} mi`;
      const mismatch =
        r.aiValue != null &&
        Math.abs(r.aiValue - r.value) > Math.max(1, r.value * 0.005);
      fields.push({
        label: "Reading",
        typed: `${num.format(r.value)} mi`,
        ai: r.aiValue != null ? `${num.format(r.aiValue)} mi` : null,
        mismatch,
      });
      aiConfidence = r.aiConfidence;
      mediaIds = r.photoMediaId ? [r.photoMediaId] : [];
      editable = ["value"];
      current = { value: r.value };
      break;
    }
    case "fuel": {
      const [row] = await db
        .select({ f: fuelLogs, odo: odometerReadings.value })
        .from(fuelLogs)
        .leftJoin(
          odometerReadings,
          eq(odometerReadings.id, fuelLogs.odometerReadingId),
        )
        .where(eq(fuelLogs.id, a.entityId))
        .limit(1);
      if (!row) return null;
      const f = row.f;
      vehicleId = f.vehicleId;
      flags = f.flags;
      headline = `Fuel ${f.gallons.toFixed(1)} gal · ${usd(f.totalCents)}`;
      mediaIds = f.receiptMediaId ? [f.receiptMediaId] : [];
      const t = await aiTaskForMedia(mediaIds, ["receipt"]);
      const out = (t?.status === "done" ? t.output : null) as {
        total_cents?: number | null;
        gallons?: number | null;
        confidence?: number;
      } | null;
      fields.push({
        label: "Total",
        typed: usd(f.totalCents),
        ai: out?.total_cents != null ? usd(out.total_cents) : null,
        mismatch:
          out?.total_cents != null &&
          Math.abs(out.total_cents - f.totalCents) > 50,
      });
      fields.push({
        label: "Gallons",
        typed: f.gallons.toFixed(3),
        ai: out?.gallons != null ? out.gallons.toFixed(3) : null,
        mismatch:
          out?.gallons != null && Math.abs(out.gallons - f.gallons) > 0.05,
      });
      fields.push({
        label: "Odometer",
        typed: row.odo != null ? `${num.format(row.odo)} mi` : "—",
      });
      fields.push({
        label: "Paid by",
        typed: f.partPurchaseId ? "Tech (reimbursement)" : "Company",
      });
      aiConfidence = out?.confidence ?? null;
      aiStatus = t
        ? t.status === "done"
          ? "done"
          : t.status.startsWith("skipped") || t.status === "failed"
            ? "skipped"
            : "pending"
        : "none";
      editable = ["gallons", "totalCents", "odometer"];
      current = {
        gallons: f.gallons,
        totalCents: f.totalCents,
        odometer: row.odo,
      };
      break;
    }
    case "service": {
      const [s] = await db
        .select()
        .from(serviceRecords)
        .where(eq(serviceRecords.id, a.entityId))
        .limit(1);
      if (!s) return null;
      vehicleId = s.vehicleId;
      headline = `Service: ${s.tasks.map(taskLabel).join(", ")}`;
      const ai = (s.aiExtract ?? null) as {
        tasks?: string[];
        total_cents?: number | null;
        confidence?: number;
        odometer?: number | null;
      } | null;
      fields.push({
        label: "Services",
        typed: s.tasks.map(taskLabel).join(", "),
        ai: ai?.tasks?.length ? ai.tasks.map(taskLabel).join(", ") : null,
      });
      fields.push({
        label: "Cost",
        typed: usd(s.costCents),
        ai: ai?.total_cents != null ? usd(ai.total_cents) : null,
        mismatch:
          ai?.total_cents != null &&
          s.costCents != null &&
          Math.abs(ai.total_cents - s.costCents) > 50,
      });
      fields.push({
        label: "Odometer",
        typed: s.odometer != null ? `${num.format(s.odometer)} mi` : "—",
        ai: ai?.odometer != null ? `${num.format(ai.odometer)} mi` : null,
      });
      fields.push({ label: "Date", typed: s.performedOn });
      if (s.vendor) fields.push({ label: "Vendor", typed: s.vendor });
      fields.push({
        label: "Paid by",
        typed: s.paidBy === "tech" ? "Tech (reimbursement)" : "Company",
      });
      aiConfidence = ai?.confidence ?? null;
      aiStatus = ai ? "done" : "none";
      mediaIds = s.receiptMediaId ? [s.receiptMediaId] : [];
      editable = ["costCents", "odometer"];
      current = { costCents: s.costCents, odometer: s.odometer };
      break;
    }
    case "document": {
      const [d] = await db
        .select()
        .from(vehicleDocuments)
        .where(eq(vehicleDocuments.id, a.entityId))
        .limit(1);
      if (!d) return null;
      vehicleId = d.vehicleId;
      headline = `Document: ${d.kind}`;
      fields.push({ label: "Kind", typed: d.kind });
      fields.push({ label: "Expires", typed: d.expiresOn ?? "—" });
      if (d.notes) fields.push({ label: "Notes", typed: d.notes });
      mediaIds = [d.mediaId];
      editable = ["expiresOn"];
      current = { expiresOn: d.expiresOn };
      break;
    }
    case "inspection": {
      const [i] = await db
        .select()
        .from(inspections)
        .where(eq(inspections.id, a.entityId))
        .limit(1);
      if (!i) return null;
      vehicleId = i.vehicleId;
      headline = i.passed ? "Inspection passed" : "Inspection: issues found";
      const results = (i.results ?? {}) as Record<
        string,
        { ok: boolean; note?: string | null }
      >;
      for (const item of INSPECTION_ITEMS) {
        const r = results[item.key];
        fields.push({
          label: item.label,
          typed: r
            ? r.ok
              ? "OK"
              : `Fail${r.note ? ` — ${r.note}` : ""}`
            : "Not checked",
          mismatch: r ? !r.ok : true,
        });
      }
      mediaIds = i.mediaIds;
      break;
    }
    case "trip": {
      const [t] = await db
        .select()
        .from(trips)
        .where(eq(trips.id, a.entityId))
        .limit(1);
      if (!t) return null;
      vehicleId = t.vehicleId;
      headline = `Trip ${t.tripDate}: ${t.miles} mi`;
      fields.push({ label: "Miles", typed: String(t.miles) });
      fields.push({
        label: "Odometer",
        typed:
          t.startOdometer != null && t.endOdometer != null
            ? `${num.format(t.startOdometer)} → ${num.format(t.endOdometer)}`
            : "—",
      });
      fields.push({ label: "Classification", typed: t.classification });
      if (t.purpose) fields.push({ label: "Purpose", typed: t.purpose });
      const dest = (t.destinations ?? [])
        .map((d) => d.address_short)
        .filter(Boolean);
      if (dest.length) fields.push({ label: "Stops", typed: dest.join(" · ") });
      fields.push({
        label: "Reimbursable",
        typed: t.reimbursable ? "Yes (mileage rate)" : "No",
      });
      editable = ["miles"];
      current = { miles: t.miles };
      break;
    }
  }

  if (type === "odometer") {
    const t = await aiTaskForMedia(mediaIds, ["odometer"]);
    aiStatus = t
      ? t.status === "done"
        ? "done"
        : t.status.startsWith("skipped") || t.status === "failed"
          ? "skipped"
          : "pending"
      : "none";
  }
  if (type === "service" && aiStatus === "none") {
    const t = await aiTaskForMedia(mediaIds, ["shop_invoice"]);
    if (t)
      aiStatus =
        t.status === "done"
          ? "done"
          : t.status.startsWith("skipped") || t.status === "failed"
            ? "skipped"
            : "pending";
  }

  const [veh, requester, images] = await Promise.all([
    vehicleId
      ? db
          .select({ nickname: vehicles.nickname })
          .from(vehicles)
          .where(eq(vehicles.id, vehicleId))
          .limit(1)
      : Promise.resolve([]),
    a.requestedBy
      ? db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, a.requestedBy))
          .limit(1)
      : Promise.resolve([]),
    mediaList(mediaIds),
  ]);
  const missing = (ev.missing ?? []).filter(
    (m) => !(m === "photo" && images.length > 0),
  );
  const flagList = flags.map((f) => ({
    code: f,
    label: ANOMALY_LABELS[f] ?? f,
  }));
  const anyMismatch = fields.some((f) => f.mismatch && type !== "inspection");
  return {
    approvalId: a.id,
    type,
    entityId: a.entityId,
    vehicleId,
    vehicleName: veh[0]?.nickname ?? ev.vehicle ?? "Vehicle",
    submittedBy: requester[0]?.name ?? null,
    submittedAt: formatDateTime(a.createdAt, await getCompanyTimezone()),
    headline,
    fields,
    aiConfidence,
    aiStatus,
    previous: ev.previous ? `${num.format(ev.previous.value)} mi` : null,
    flags: flagList,
    missing: missing.map((m) => ({ code: m, label: MISSING_LABELS[m] ?? m })),
    images,
    clean:
      flagList.length === 0 &&
      missing.length === 0 &&
      !anyMismatch &&
      !(ev.awaiting_ai && aiStatus === "pending"),
    editable,
    current,
  };
}
