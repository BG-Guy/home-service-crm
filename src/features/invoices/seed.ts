// Demo seed fragment for `invoices` (BUILD_PLAN §10.3 #10). Owner: B3.
// Invoices (seedId('invoice', n)) with lines (part_source; tech-purchased lines carry
// part_purchase_id = seedId('part_purchase','j<n>')), revision v1 for every issued
// invoice (snapshot + sha256), the J33 revision after payment, the J25 goodwill
// credit note, draft invoices for jobs in progress, completion signatures on 40
// jobs and the tech1/tech2 comp-agreement signatures. Plan totals are
// authoritative. Writes only B3 tables (+ media via the F helper, activity via the
// F lib). Never emits events; rerunnable (deterministic ids + onConflictDoNothing).
import { inArray, sql } from "drizzle-orm";
import { type DB, execRows } from "@/db";
import {
  creditNotes,
  invoiceRevisions,
  invoices,
  jobs,
  lineItems,
  policyVersions,
  signatures,
} from "@/db/schema";
import { seedId } from "@/db/seed/demo-ids";
import type { DemoJob, DemoLine } from "@/db/seed/demo-plan";
import { seedPlaceholderMedia } from "@/db/seed/helpers";
import type { DemoSeedCtx } from "@/db/seed/types";
import { writeActivity } from "@/lib/activity";
import { sha256Json } from "@/lib/hash";
import { formatMoney } from "@/lib/money";
import { dueDateFor, TERMS_LABEL } from "./math";
import { buildInvoiceSnapshot } from "./snapshot";

const MIN = 60_000;
const DAY = 86_400_000;

type LineRow = typeof lineItems.$inferInsert;

function lineRows(
  j: DemoJob,
  invoiceId: string,
  lines: DemoLine[],
  prefix = "",
): LineRow[] {
  return lines.map((l, i) => ({
    id: seedId("line", `inv-j${j.n}${prefix}-${i}`),
    parentType: "invoice",
    parentId: invoiceId,
    sort: i,
    type: l.type,
    pricebookItemId:
      l.type === "discount" ? null : seedId("pricebook", l.pricebookKey),
    name: l.name,
    qty: l.qty,
    unitPriceCents: Math.abs(l.unitPriceCents),
    unitCostCents: l.unitCostCents,
    discountCents: 0,
    totalCents: l.totalCents,
    taxable: l.taxable,
    partSource: l.partSource,
    partPurchaseId:
      l.partSource === "tech_purchased"
        ? seedId("part_purchase", `j${j.n}`)
        : null,
    isServiceFee: l.isServiceFee,
    warrantyDays: l.type === "part" ? 365 : l.type === "service" ? 90 : null,
  }));
}

export async function seedDemo(db: DB, ctx: DemoSeedCtx): Promise<void> {
  const plan = ctx.plan;
  const times = new Map(
    (
      await db
        .select({
          id: jobs.id,
          completedAt: jobs.completedAt,
          startedAt: jobs.startedAt,
        })
        .from(jobs)
        .where(
          inArray(
            jobs.id,
            plan.jobs.map((j) => j.id),
          ),
        )
    ).map((r) => [r.id, r]),
  );
  const done = (j: DemoJob): Date => {
    const t = times.get(j.id)?.completedAt;
    if (t) return t;
    const ws = ctx.at(j.dayOffset ?? 0, j.windowStart ?? "10:00");
    const est = new Date(ws.getTime() + (j.windowMinutes + 15) * MIN);
    return est > ctx.now ? new Date(ctx.now.getTime() - 20 * MIN) : est;
  };
  const customer = (n: number) => plan.customers[n - 1];

  const issued = plan.jobs
    .filter((j) => j.invoiced)
    .sort((a, b) => done(a).getTime() - done(b).getTime());
  const drafts = plan.jobs.filter(
    (j) =>
      !j.invoiced &&
      (j.status === "in_progress" || j.status === "on_hold") &&
      j.lines.length > 0,
  );

  let seq = 0;
  let revisions = 0;
  for (const j of [...issued, ...drafts]) {
    const id = seedId("invoice", j.n);
    const number = `INV-${1001 + seq++}`;
    const c = customer(j.customerN);
    const isIssued = j.invoiced;
    const issuedAt = isIssued ? done(j) : null;
    const terms = c?.terms ?? "due_on_receipt";
    const dueAt = issuedAt ? dueDateFor(terms, issuedAt) : null;
    const paid = j.payments
      .filter((p) => p.kind === "payment" || p.kind === "deposit")
      .reduce((a, p) => a + p.amountCents, 0);
    const status = !isIssued
      ? "draft"
      : j.totals.totalCents === 0 || paid >= j.totals.totalCents
        ? "paid"
        : paid > 0
          ? "partially_paid"
          : "issued";
    const version = j.revisedAfterPayment ? 2 : 1;
    await db
      .insert(invoices)
      .values({
        id,
        number,
        jobId: j.id,
        customerId: j.customerId,
        propertyId: j.propertyId,
        status,
        version,
        issuedAt,
        dueAt,
        subtotalCents: j.totals.subtotalCents,
        discountCents: j.totals.discountCents,
        taxCents: j.totals.taxCents,
        totalCents: j.totals.totalCents,
        terms: TERMS_LABEL[terms],
        notes:
          j.callbackOf != null
            ? `No-charge return visit for J-${1000 + j.callbackOf}.`
            : null,
        warrantyText:
          "Workmanship warranty: 90 days from the date of service. Parts: 1 year.",
        showPhotos: true,
        photoMediaIds: [],
        descriptorSuffix: j.number.replace("-", ""),
        createdBy: j.tech ? seedId("user", j.tech) : seedId("user", "office"),
        createdAt: issuedAt ?? ctx.now,
        updatedAt: issuedAt ?? ctx.now,
      })
      .onConflictDoNothing();
    const rows = lineRows(j, id, j.lines);
    if (rows.length)
      await db.insert(lineItems).values(rows).onConflictDoNothing();
    if (!issuedAt) continue;

    const snap = (ls: LineRow[], v: number, totals: typeof j.totals) =>
      buildInvoiceSnapshot(
        {
          id,
          number,
          version: v,
          jobId: j.id,
          customerId: j.customerId,
          issuedAt,
          dueAt,
          ...totals,
          notes: null,
          terms: TERMS_LABEL[terms],
          warrantyText:
            "Workmanship warranty: 90 days from the date of service. Parts: 1 year.",
        },
        ls.map((l) => ({
          id: l.id as string,
          sort: l.sort ?? 0,
          type: l.type,
          name: l.name,
          description: null,
          qty: Number(l.qty ?? 1),
          unitPriceCents: l.unitPriceCents,
          discountCents: 0,
          totalCents: l.totalCents,
          taxable: !!l.taxable,
          taxRateBps: null,
          partSource: l.partSource ?? null,
          warrantyDays: l.warrantyDays ?? null,
          serial: null,
        })),
      );

    if (j.revisedAfterPayment) {
      // v1 carried a trip fee ($49 in the default demo) the office removed after the
      // customer paid.
      const trip = plan.pricebook.find((p) => p.key === "trip_fee");
      const tripName = trip?.name ?? "Trip fee";
      const tripCents = trip?.unitPriceCents ?? 4900;
      const extra: LineRow = {
        ...(lineRows(
          j,
          id,
          [
            {
              pricebookKey: "trip_fee",
              type: "fee",
              name: tripName,
              qty: 1,
              unitPriceCents: tripCents,
              unitCostCents: null,
              taxable: false,
              partSource: null,
              isServiceFee: false,
              totalCents: tripCents,
            },
          ],
          "-v1",
        )[0] as LineRow),
        sort: rows.length,
      };
      const v1Totals = {
        ...j.totals,
        subtotalCents: j.totals.subtotalCents + tripCents,
        totalCents: j.totals.totalCents + tripCents,
      };
      const s1 = snap([...rows, extra], 1, v1Totals);
      const s2 = snap(rows, 2, j.totals);
      await db
        .insert(invoiceRevisions)
        .values([
          {
            id: seedId("invoice_revision", `j${j.n}-1`),
            invoiceId: id,
            version: 1,
            snapshot: s1 as never,
            sha256: sha256Json(s1),
            reason: "issued",
            createdBy: j.tech ? seedId("user", j.tech) : null,
            createdAt: issuedAt,
          },
          {
            id: seedId("invoice_revision", `j${j.n}-2`),
            invoiceId: id,
            version: 2,
            snapshot: s2 as never,
            sha256: sha256Json(s2),
            diff: {
              added: [],
              removed: [
                { id: extra.id, name: tripName, totalCents: tripCents },
              ],
              changed: [],
              totals: {
                totalCents: {
                  from: v1Totals.totalCents,
                  to: j.totals.totalCents,
                },
              },
              fields: {},
              afterPayment: true,
            } as never,
            reason: "Customer said the trip fee was waived on the phone",
            createdBy: seedId("user", "office"),
            createdAt: new Date(issuedAt.getTime() + 2 * DAY),
          },
        ])
        .onConflictDoNothing();
      revisions += 2;
    } else {
      const s1 = snap(rows, 1, j.totals);
      await db
        .insert(invoiceRevisions)
        .values({
          id: seedId("invoice_revision", `j${j.n}-1`),
          invoiceId: id,
          version: 1,
          snapshot: s1 as never,
          sha256: sha256Json(s1),
          reason: "issued",
          createdBy: j.tech ? seedId("user", j.tech) : null,
          createdAt: issuedAt,
        })
        .onConflictDoNothing();
      revisions++;
    }

    // J25: the $50 partial refund was a goodwill concession → credit note keeps the
    // balance at $0 (refunds add back to the balance; credits take it off).
    if (j.refund?.status === "succeeded") {
      await db
        .insert(creditNotes)
        .values({
          id: seedId("credit_note", `j${j.n}`),
          number: "CN-1001",
          invoiceId: id,
          amountCents: j.refund.amountCents,
          reason: "Goodwill adjustment (refunded to card)",
          createdBy: seedId("user", "office"),
          createdAt: new Date(issuedAt.getTime() + 3 * DAY),
        })
        .onConflictDoNothing();
    }

    await writeActivity(db, {
      entity: { type: "invoice", id },
      customerId: j.customerId,
      jobId: j.id,
      kind: "invoice.issued",
      summary: `Invoice ${number} issued · ${formatMoney(j.totals.totalCents)}`,
      data: { via: "job_completed", total_cents: j.totals.totalCents },
      actorUserId: j.tech ? seedId("user", j.tech) : null,
    });
  }

  // Completion signatures on 40 completed jobs (geostamped at the property).
  const policies = await db
    .select()
    .from(policyVersions)
    .where(inArray(policyVersions.kind, ["esign_consent", "comp_agreement"]));
  const latest = (kind: string) =>
    policies
      .filter((p) => p.kind === kind)
      .sort((a, b) => b.version - a.version)[0];
  const esign = latest("esign_consent");
  const completed = plan.jobs
    .filter(
      (j) =>
        (j.status === "completed" || j.status === "closed") &&
        j.dayOffset != null,
    )
    .slice(0, 40);
  for (const j of completed) {
    const c = customer(j.customerN);
    const prop = c?.properties.find((p) => p.id === j.propertyId);
    const at = new Date(done(j).getTime() - 2 * MIN);
    const sigId = seedId("signature", `completion-j${j.n}`);
    const snapshot = {
      v: 1,
      kind: "completion",
      jobId: j.id,
      number: j.number,
      title: j.title,
      totalCents: j.totals.totalCents,
      statement: "The work described was completed to my satisfaction.",
    };
    const mediaId = await seedPlaceholderMedia(db, {
      id: seedId("media", `sig-completion-j${j.n}`),
      kind: "signature",
      tag: "signature",
      jobId: j.id,
      customerId: j.customerId,
      entity: { type: "job", id: j.id },
      label: c?.displayName ?? "Signature",
      color: "#f2f2f7",
      capturedAt: at,
      evidenceLocked: true,
      geo: prop ? { lat: prop.lat, lng: prop.lng } : null,
    });
    await db
      .insert(signatures)
      .values({
        id: sigId,
        docType: "completion",
        docId: j.id,
        docSha256: sha256Json(snapshot),
        docSnapshot: snapshot,
        policyVersionIds: esign ? [esign.id] : [],
        signerName: c?.displayName ?? "Customer",
        signerKind: "customer",
        customerId: j.customerId,
        signatureMediaId: mediaId,
        channel: "in_person",
        esignConsent: true,
        consentText: esign?.body ?? "I agree to sign electronically.",
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
        lat: prop ? prop.lat + 0.00005 : null,
        lng: prop ? prop.lng + 0.00004 : null,
        accuracyM: 8,
        deviceTs: at,
        signedAt: at,
      })
      .onConflictDoNothing();
  }

  // Comp agreements (B6 tech_comp.agreement_signature_id points here; tech3 unsigned).
  const comp = latest("comp_agreement");
  for (const key of ["tech1", "tech2"] as const) {
    const u = plan.users.find((x) => x.key === key);
    if (!u?.agreementSigned) continue;
    const at = new Date(ctx.now.getTime() - 75 * DAY);
    const snapshot = {
      v: 1,
      kind: "comp_agreement",
      userId: u.id,
      planKey: u.planKey,
      policyVersionId: comp?.id ?? null,
    };
    await db
      .insert(signatures)
      .values({
        id: seedId("signature", `comp-${key}`),
        docType: "comp_agreement",
        docId: seedId("tech_comp", key),
        docSha256: sha256Json(snapshot),
        docSnapshot: snapshot,
        policyVersionIds: comp ? [comp.id] : [],
        signerName: u.name,
        signerKind: "user",
        signerUserId: u.id,
        channel: "in_person",
        esignConsent: true,
        consentText: esign?.body ?? "I agree to sign electronically.",
        deviceTs: at,
        signedAt: at,
      })
      .onConflictDoNothing();
  }

  await execRows(
    sql`insert into counters (key, prefix, next_value) values ('invoice', 'INV-', ${1001 + seq})
        on conflict (key) do update set next_value = greatest(counters.next_value, excluded.next_value)`,
    db,
  );
  await execRows(
    sql`insert into counters (key, prefix, next_value) values ('credit_note', 'CN-', 1002)
        on conflict (key) do update set next_value = greatest(counters.next_value, excluded.next_value)`,
    db,
  );
  ctx.log(
    `invoices: ${issued.length} issued, ${drafts.length} drafts, ${revisions} revisions, ${completed.length} completion signatures`,
  );
}
