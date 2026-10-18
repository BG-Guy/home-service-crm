// Demo seed fragment for `estimates` (BUILD_PLAN §10.3 #9). Owner: B3.
// Estimates (job ones from DEMO.jobs[].estimate + the standalone ones), options and
// lines, the J41 change order (signed), estimate signatures (snapshot + sha256 +
// policy versions) and magic links for the sent ones. Writes only B3 tables (plus
// media via the F helper and public_tokens via the F lib). Never emits events;
// rerunnable (deterministic ids + onConflictDoNothing).
import { inArray, sql } from "drizzle-orm";
import { type DB, execRows } from "@/db";
import {
  changeOrders,
  estimateOptions,
  estimates,
  jobs,
  lineItems,
  policyVersions,
  signatures,
} from "@/db/schema";
import { seedId } from "@/db/seed/demo-ids";
import type { DemoJob, DemoLine } from "@/db/seed/demo-plan";
import { seedPlaceholderMedia } from "@/db/seed/helpers";
import type { DemoSeedCtx } from "@/db/seed/types";
import { computeTotals } from "@/features/invoices/math";
import { sha256Json } from "@/lib/hash";
import { mintPublicToken } from "@/lib/tokens";
import { buildChangeOrderSnapshot, buildEstimateSnapshot } from "./logic";

const DAY = 86_400_000;
const MIN = 60_000;

type LineRow = typeof lineItems.$inferInsert;

function lineRow(
  id: string,
  parentType: "estimate_option" | "change_order",
  parentId: string,
  sort: number,
  l: DemoLine,
  extra: { isOptional?: boolean; isSelected?: boolean } = {},
): LineRow {
  return {
    id,
    parentType,
    parentId,
    sort,
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
    isServiceFee: l.isServiceFee,
    isOptional: extra.isOptional ?? false,
    isSelected: extra.isSelected ?? true,
  };
}

type Addon = DemoSeedCtx["profile"]["estimates"]["addons"][number];

function addonLineFor(addons: Addon[], i: number): DemoLine {
  const a = addons[i % addons.length] as Addon;
  return {
    pricebookKey: a.key,
    type: a.type,
    name: a.name,
    qty: 1,
    unitPriceCents: a.cents,
    unitCostCents: null,
    taxable: a.taxable,
    partSource: a.type === "part" ? "company_stock" : null,
    isServiceFee: false,
    totalCents: a.cents,
  };
}

/** Good / Better / Best around the job's real lines (Better = what was sold). */
function gbb(
  lines: DemoLine[],
  n: number,
  copy: DemoSeedCtx["profile"]["estimates"],
) {
  const addonLine = (i: number) => addonLineFor(copy.addons, i);
  const nonFee = lines.filter((l) => !l.isServiceFee && l.type !== "discount");
  const priciest = [...nonFee].sort((a, b) => b.totalCents - a.totalCents)[0];
  // Good: the essentials only (drop the priciest extra part, or one fewer of it).
  let good = lines;
  if (priciest && priciest.qty > 1)
    good = lines.map((l) =>
      l === priciest
        ? {
            ...l,
            qty: l.qty - 1,
            totalCents: Math.round((l.qty - 1) * l.unitPriceCents),
          }
        : l,
    );
  else if (priciest && lines.filter((l) => !l.isServiceFee).length > 1)
    good = lines.filter((l) => l !== priciest);
  return [
    { label: "Good", lines: good, addons: [] as DemoLine[] },
    { label: "Better", lines, addons: [addonLine(n)] },
    {
      label: "Best",
      lines: [
        ...lines,
        {
          ...addonLine(n + 1),
          name: copy.bestUpgrade.name,
          pricebookKey: copy.bestUpgrade.pricebookKey,
          type: copy.bestUpgrade.type,
          unitPriceCents: copy.bestUpgrade.cents,
          totalCents: copy.bestUpgrade.cents,
          taxable: false,
          partSource: null,
        },
      ],
      addons: [addonLine(n)],
    },
  ];
}

export async function seedDemo(db: DB, ctx: DemoSeedCtx): Promise<void> {
  const plan = ctx.plan;
  const jobRows = await db
    .select({
      id: jobs.id,
      startedAt: jobs.startedAt,
      arrivedAt: jobs.arrivedAt,
    })
    .from(jobs)
    .where(
      inArray(
        jobs.id,
        plan.jobs.map((j) => j.id),
      ),
    );
  const jobTimes = new Map(jobRows.map((r) => [r.id, r]));
  const policies = await db
    .select()
    .from(policyVersions)
    .where(
      inArray(policyVersions.kind, [
        "warranty",
        "deposit",
        "cancellation",
        "esign_consent",
      ]),
    );
  const latest = new Map<string, (typeof policies)[number]>();
  for (const p of policies) {
    const cur = latest.get(p.kind);
    if (!cur || p.version > cur.version) latest.set(p.kind, p);
  }
  const pol = [...latest.values()];
  const esign = latest.get("esign_consent");

  type Plan = {
    key: string;
    id: string;
    job: DemoJob | null;
    customerId: string;
    propertyId: string | null;
    status: "draft" | "sent" | "viewed" | "approved" | "declined" | "expired";
    createdAt: Date;
    title: string;
    options: { label: string; lines: DemoLine[]; addons: DemoLine[] }[];
  };
  const list: Plan[] = [];
  const serviceCall = plan.pricebook.find((p) => p.key === "service_call");
  for (const j of plan.jobs) {
    if (!j.estimate) continue;
    const base = ctx.at(j.dayOffset ?? 0, j.windowStart ?? "10:00");
    const t = jobTimes.get(j.id);
    const approvedAt = new Date(
      (t?.startedAt ?? t?.arrivedAt ?? base).getTime() - 6 * MIN,
    );
    const createdAt =
      j.estimate.outcome === "approved"
        ? new Date(approvedAt.getTime() - 25 * MIN)
        : new Date(ctx.now.getTime() - (j.n === 79 ? 2 : 3) * DAY);
    const lines = j.lines.length
      ? j.lines
      : [
          {
            pricebookKey: "service_call",
            type: "service" as const,
            name: serviceCall?.name ?? "Service call / diagnostic",
            qty: 1,
            unitPriceCents: serviceCall?.unitPriceCents ?? 8900,
            unitCostCents: null,
            taxable: false,
            partSource: null,
            isServiceFee: true,
            totalCents: serviceCall?.unitPriceCents ?? 8900,
          },
        ];
    // J41's last line came in through the signed change order.
    const estLines =
      j.n === 41 && lines.length > 1 ? lines.slice(0, -1) : lines;
    list.push({
      key: `j${j.n}`,
      id: seedId("estimate", `j${j.n}`),
      job: j,
      customerId: j.customerId,
      propertyId: j.propertyId,
      status: j.estimate.outcome,
      createdAt,
      title: j.title,
      options:
        j.estimate.options === 3
          ? gbb(estLines, j.n, ctx.profile.estimates)
          : [{ label: "Option 1", lines: estLines, addons: [] }],
    });
  }
  for (const s of plan.estimates) {
    const c = plan.customers[s.customerN - 1];
    if (!c) continue;
    list.push({
      key: s.key,
      id: s.id,
      job: null,
      customerId: c.id,
      propertyId: c.properties[0]?.id ?? null,
      status: s.status,
      createdAt: ctx.at(s.dayOffset, "11:00"),
      title: s.lines[0]?.name ?? "Estimate",
      options: [{ label: "Option 1", lines: s.lines, addons: [] }],
    });
  }
  list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  let sigCount = 0;
  const links: string[] = [];
  for (const [i, e] of list.entries()) {
    const number = `EST-${1001 + i}`;
    const approved = e.status === "approved";
    const sentAt =
      e.status === "draft" ? null : new Date(e.createdAt.getTime() + 2 * MIN);
    const approvedAt = approved
      ? new Date(e.createdAt.getTime() + 25 * MIN)
      : null;
    const optionIds = e.options.map((_, k) =>
      seedId("estimate_option", `${e.key}-${k}`),
    );
    const chosenIdx = e.options.length === 3 ? 1 : 0;
    const signatureId = approved ? seedId("signature", `est-${e.key}`) : null;
    await db
      .insert(estimates)
      .values({
        id: e.id,
        number,
        jobId: e.job?.id ?? null,
        customerId: e.customerId,
        propertyId: e.propertyId,
        status: e.status,
        title: e.title,
        notes:
          e.options.length === 3
            ? "Three ways to fix it — the Better option is what most customers choose."
            : null,
        warrantyText: "90-day workmanship warranty from the date of service.",
        expiresAt: new Date(e.createdAt.getTime() + 30 * DAY),
        sentAt,
        viewedAt:
          e.status === "viewed" || approved || e.status === "declined"
            ? new Date((sentAt ?? e.createdAt).getTime() + 3 * 3600_000)
            : null,
        approvedAt,
        declinedAt:
          e.status === "declined"
            ? new Date(e.createdAt.getTime() + 2 * DAY)
            : null,
        declineReason:
          e.status === "declined"
            ? e.key.startsWith("c15")
              ? "Price — going to think about it"
              : "Went with another company"
            : null,
        approvedOptionId: approved ? (optionIds[chosenIdx] ?? null) : null,
        signatureId,
        approvalChannel: approved ? "in_person" : null,
        policyVersionIds: approved ? pol.map((p) => p.id) : [],
        createdBy: e.job?.tech
          ? seedId("user", e.job.tech)
          : seedId("user", "office"),
        createdAt: e.createdAt,
        updatedAt: approvedAt ?? sentAt ?? e.createdAt,
      })
      .onConflictDoNothing();
    const allLines: LineRow[] = [];
    for (const [k, o] of e.options.entries()) {
      const oid = optionIds[k] as string;
      await db
        .insert(estimateOptions)
        .values({
          id: oid,
          estimateId: e.id,
          label: o.label,
          sort: k,
          recommended: k === chosenIdx,
          notes:
            e.options.length === 3
              ? ([
                  "Gets you working again today.",
                  "Fixes the cause, not just the symptom.",
                  "Everything in Better plus premium parts and a longer warranty.",
                ][k] ?? null)
              : null,
          createdAt: e.createdAt,
          updatedAt: e.createdAt,
        })
        .onConflictDoNothing();
      const rows = [
        ...o.lines.map((l, s) =>
          lineRow(
            seedId("line", `${e.key}-${k}-${s}`),
            "estimate_option",
            oid,
            s,
            l,
          ),
        ),
        ...o.addons.map((l, s) =>
          lineRow(
            seedId("line", `${e.key}-${k}-a${s}`),
            "estimate_option",
            oid,
            100 + s,
            l,
            {
              isOptional: true,
              isSelected: false,
            },
          ),
        ),
      ];
      if (rows.length)
        await db.insert(lineItems).values(rows).onConflictDoNothing();
      allLines.push(...rows);
    }

    if (approved && signatureId && e.job) {
      const k = chosenIdx;
      const oid = optionIds[k] as string;
      const optLines = allLines.filter(
        (l) => l.parentId === oid && !l.isOptional,
      );
      const totals = computeTotals(
        optLines.map((l) => ({
          type: l.type as never,
          totalCents: l.totalCents,
          taxable: !!l.taxable,
        })),
        plan.taxBps,
      );
      const snapshot = buildEstimateSnapshot({
        estimate: {
          id: e.id,
          number,
          title: e.title,
          customerId: e.customerId,
          jobId: e.job.id,
          expiresAt: new Date(e.createdAt.getTime() + 30 * DAY),
          notes: null,
          warrantyText: "90-day workmanship warranty from the date of service.",
        },
        option: { id: oid, label: e.options[k]?.label ?? "Option 1" },
        lines: optLines.map((l) => ({
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
          isOptional: false,
        })),
        selectedAddonIds: [],
        totals,
        policies: pol.map((p) => ({
          id: p.id,
          kind: p.kind,
          version: p.version,
          sha256: p.sha256,
        })),
        depositCents: e.job.deposit?.amountCents ?? null,
      });
      const cust = plan.customers[e.job.customerN - 1];
      const prop = cust?.properties.find((p) => p.id === e.job?.propertyId);
      const mediaId = await seedPlaceholderMedia(db, {
        id: seedId("media", `sig-est-${e.key}`),
        kind: "signature",
        tag: "signature",
        jobId: e.job.id,
        customerId: e.customerId,
        entity: { type: "estimate", id: e.id },
        label: cust?.displayName ?? "Signature",
        color: "#f2f2f7",
        capturedAt: approvedAt as Date,
        evidenceLocked: true,
      });
      await db
        .insert(signatures)
        .values({
          id: signatureId,
          docType: "estimate",
          docId: e.id,
          docSha256: sha256Json(snapshot),
          docSnapshot: snapshot as never,
          policyVersionIds: pol.map((p) => p.id),
          signerName: cust?.displayName ?? "Customer",
          signerKind: "customer",
          customerId: e.customerId,
          signatureMediaId: mediaId,
          channel: "in_person",
          esignConsent: true,
          consentText: esign?.body ?? "I agree to sign electronically.",
          ip: "203.0.113.24",
          userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
          lat: prop ? prop.lat + 0.00008 : null,
          lng: prop ? prop.lng - 0.00006 : null,
          accuracyM: 9,
          deviceTs: approvedAt,
          signedAt: approvedAt as Date,
        })
        .onConflictDoNothing();
      sigCount++;
    }

    if (e.status === "sent" || e.status === "viewed") {
      const [have] = await execRows<{ n: number }>(
        sql`select count(*)::int as n from public_tokens where entity_type = 'estimate' and entity_id = ${e.id}`,
        db,
      );
      if (Number(have?.n ?? 0) === 0) {
        const link = await mintPublicToken(db, {
          kind: "estimate",
          entity: { type: "estimate", id: e.id },
          customerId: e.customerId,
          jobId: e.job?.id ?? null,
          expiresAt: new Date(e.createdAt.getTime() + 30 * DAY),
        });
        links.push(`${number}: ${link.url}`);
      }
    }
  }

  // J41: the signed change order (its line is the last of the job's lines).
  const j41 = plan.jobs[40];
  if (j41 && j41.lines.length > 1) {
    const coId = seedId("change_order", "j41");
    const coLine = j41.lines[j41.lines.length - 1] as DemoLine;
    const row = lineRow(
      seedId("line", "co-j41-0"),
      "change_order",
      coId,
      0,
      coLine,
    );
    const totals = computeTotals(
      [
        {
          type: coLine.type,
          totalCents: coLine.totalCents,
          taxable: coLine.taxable,
        },
      ],
      plan.taxBps,
    );
    const t = jobTimes.get(j41.id);
    const at = new Date(
      (t?.startedAt ?? ctx.at(j41.dayOffset ?? -19, "10:00")).getTime() +
        30 * MIN,
    );
    const sigId = seedId("signature", "co-j41");
    await db
      .insert(changeOrders)
      .values({
        id: coId,
        number: "CO-1001",
        jobId: j41.id,
        estimateId: j41.estimate ? seedId("estimate", "j41") : null,
        reason: `Found more wear once opened up: ${coLine.name.toLowerCase()} needed too`,
        status: "approved",
        deltaCents: totals.totalCents,
        signatureId: sigId,
        createdBy: j41.tech ? seedId("user", j41.tech) : null,
        createdAt: new Date(at.getTime() - 10 * MIN),
        updatedAt: at,
      })
      .onConflictDoNothing();
    await db.insert(lineItems).values(row).onConflictDoNothing();
    const snap = buildChangeOrderSnapshot({
      changeOrder: {
        id: coId,
        number: "CO-1001",
        jobId: j41.id,
        reason: "Additional part needed",
      },
      lines: [
        {
          id: row.id as string,
          sort: 0,
          type: coLine.type,
          name: coLine.name,
          description: null,
          qty: coLine.qty,
          unitPriceCents: coLine.unitPriceCents,
          discountCents: 0,
          totalCents: coLine.totalCents,
          taxable: coLine.taxable,
          isOptional: false,
        },
      ],
      totals,
      signedTotalCents: null,
      policies: pol.map((p) => ({
        id: p.id,
        kind: p.kind,
        version: p.version,
        sha256: p.sha256,
      })),
    });
    const cust = plan.customers[j41.customerN - 1];
    const mediaId = await seedPlaceholderMedia(db, {
      id: seedId("media", "sig-co-j41"),
      kind: "signature",
      tag: "signature",
      jobId: j41.id,
      customerId: j41.customerId,
      entity: { type: "change_order", id: coId },
      label: cust?.displayName ?? "Signature",
      color: "#f2f2f7",
      capturedAt: at,
      evidenceLocked: true,
    });
    await db
      .insert(signatures)
      .values({
        id: sigId,
        docType: "change_order",
        docId: coId,
        docSha256: sha256Json(snap),
        docSnapshot: snap as never,
        policyVersionIds: pol.map((p) => p.id),
        signerName: cust?.displayName ?? "Customer",
        signerKind: "customer",
        customerId: j41.customerId,
        signatureMediaId: mediaId,
        channel: "in_person",
        esignConsent: true,
        consentText: esign?.body ?? "I agree to sign electronically.",
        deviceTs: at,
        signedAt: at,
      })
      .onConflictDoNothing();
    sigCount++;
  }

  await execRows(
    sql`insert into counters (key, prefix, next_value) values ('estimate', 'EST-', ${1001 + list.length})
        on conflict (key) do update set next_value = greatest(counters.next_value, excluded.next_value)`,
    db,
  );
  await execRows(
    sql`insert into counters (key, prefix, next_value) values ('change_order', 'CO-', 1002)
        on conflict (key) do update set next_value = greatest(counters.next_value, excluded.next_value)`,
    db,
  );
  ctx.log(
    `estimates: ${list.length} estimates, ${sigCount} signatures, 1 change order`,
  );
  for (const l of links) ctx.log(`  customer link ${l}`);
}
