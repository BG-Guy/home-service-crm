// B3 regression tests (QA round 2) on a throwaway PGlite:
// - T5-05: the customer statement is row-scoped and masks contact details.
// - T5-11: invoice and estimate documents mask email/phone/street outside the window.
// - T5-12b: a signature image must belong to the signed document (or its job).
// - T5-19: public magic-link uploads are capped per document.
// - T1-02: completing a job never auto-issues an empty $0 invoice.
// - T5-09 / T2-15: createEstimate binds property and lead; the lead is booked on send.
// - Estimate photos: attaching job photos is a per-estimate option (on by default).
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-b3-test-"),
);
process.env.PGLITE_DIR = path.join(root, "pglite");
process.env.UPLOADS_DIR = path.join(root, "uploads");
process.env.CRM_DISABLE_BACKGROUND = "1";
process.env.CRON_PIGGYBACK = "0";
process.env.AI_PROVIDER = "none";

const auth = vi.hoisted(() => ({
  user: null as null | import("@/lib/types").SessionUser,
}));
vi.mock("@/lib/auth/current", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/current")>();
  const check = async (perm?: string | string[], any = false) => {
    if (!auth.user) throw new Error("NEXT_REDIRECT /login");
    const list = perm ? (Array.isArray(perm) ? perm : [perm]) : [];
    const ok = any
      ? list.some((p) => auth.user?.perms.has(p as never))
      : list.every((p) => auth.user?.perms.has(p as never));
    if (list.length && !ok) {
      const { ForbiddenError } = await import("@/lib/errors");
      throw new ForbiddenError(undefined, list[0]);
    }
    return auth.user;
  };
  return {
    ...actual,
    getCurrentUser: async () => auth.user,
    requireUser: (perm?: string | string[]) => check(perm),
    requireAnyPerm: (perms: string[]) => check(perms, true),
  };
});

import { and, eq, sql } from "drizzle-orm";
import { closeDb, db, ensureDb, execRows } from "@/db";
import {
  customers,
  estimateOptions,
  estimates,
  invoices,
  jobAssignments,
  jobs,
  leads,
  media,
  properties,
} from "@/db/schema";
import "@/db/seed/register";
import {
  createEstimate,
  setEstimatePhotos,
} from "@/features/estimates/actions";
import {
  createEstimateDraft,
  loadEstimate,
  markEstimateSent,
} from "@/features/estimates/api";
import { loadEstimateDocForViewer } from "@/features/estimates/doc";
import { listEstimatesForViewer } from "@/features/estimates/queries";
import {
  addJobLine,
  EMPTY_INVOICE_MESSAGE,
  getOrCreateDraftInvoice,
  insertLines,
  issueInvoiceForJob,
} from "@/features/invoices/api";
import { areaLine, maskContact } from "@/features/invoices/masking";
import { loadInvoiceForViewer } from "@/features/invoices/page-data";
import { getStatement } from "@/features/invoices/queries";
import {
  captureSignature,
  SIGNATURE_MEDIA_ERROR,
} from "@/features/signatures/api";
import {
  MAX_PUBLIC_FILES_PER_DOC,
  publicPresign,
} from "@/features/signatures/public-upload.server";
import { loadSessionUser } from "@/lib/auth/current";
import { acceptInvite, createInvite, signup } from "@/lib/auth/flows";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { mintPublicToken } from "@/lib/tokens";
import { type Actor, type SessionUser, SYSTEM_ACTOR } from "@/lib/types";

let admin: SessionUser;
let tech: SessionUser;
let tech2: SessionUser;
let custA: string;
let propA: string;
let custB: string;
let propB: string;
let jobA: string;
let jobB: string;
const PASSWORD = "tangerine-kayak-41";
let n = 0;

const actorOf = (u: SessionUser): Actor => ({ kind: "user", userId: u.id });
const PUBLIC_ACTOR: Actor = { kind: "public_token", userId: null };

async function invite(name: string, email: string): Promise<SessionUser> {
  const inv = await db.transaction((tx) =>
    createInvite(tx, { name, email, role: "tech" }, SYSTEM_ACTOR),
  );
  const s = await acceptInvite({
    token: inv.token,
    password: PASSWORD,
    monitoringAck: true,
    esignConsent: true,
  });
  return (await loadSessionUser(s.userId, s.sessionId)) as SessionUser;
}

async function customerWithProperty(name: string, email: string) {
  const [c] = await db
    .insert(customers)
    .values({
      displayName: name,
      firstName: name.split(" ")[0],
      phone: "+15125550142",
      email,
    } as never)
    .returning({ id: customers.id });
  const [p] = await db
    .insert(properties)
    .values({
      customerId: c?.id,
      street: "100 Congress Ave",
      city: "Austin",
      state: "TX",
      zip: "78701",
      lat: 30.2639,
      lng: -97.7442,
    } as never)
    .returning({ id: properties.id });
  return { customerId: c?.id as string, propertyId: p?.id as string };
}

async function jobFor(
  customerId: string,
  propertyId: string,
  techId: string,
): Promise<string> {
  n++;
  const [j] = await db
    .insert(jobs)
    .values({
      number: `J-T${n}`,
      customerId,
      propertyId,
      title: "Rekey",
    } as never)
    .returning({ id: jobs.id });
  await db
    .insert(jobAssignments)
    .values({ jobId: j?.id as string, userId: techId });
  return j?.id as string;
}

async function signatureMedia(v: Partial<typeof media.$inferInsert>) {
  n++;
  const [m] = await db
    .insert(media)
    .values({
      kind: "signature",
      tag: "signature",
      storageKey: `test/sig-${n}.png`,
      mime: "image/png",
      ...v,
    })
    .returning({ id: media.id });
  return m?.id as string;
}

beforeAll(async () => {
  await ensureDb();
  const res = await signup({
    companyName: "B3 Locks",
    name: "Ada Admin",
    email: "ada@example.com",
    password: PASSWORD,
    timezone: "America/Chicago",
    state: "tx",
  });
  admin = (await loadSessionUser(
    res.userId,
    res.session?.sessionId as string,
  )) as SessionUser;
  tech = await invite("Tom Tech", "tom@example.com");
  tech2 = await invite("Tina Tech", "tina@example.com");
  ({ customerId: custA, propertyId: propA } = await customerWithProperty(
    "Pat Customer",
    "pat@example.com",
  ));
  ({ customerId: custB, propertyId: propB } = await customerWithProperty(
    "Quinn Other",
    "quinn@example.com",
  ));
  jobA = await jobFor(custA, propA, tech.id); // unscheduled: no contact window
  jobB = await jobFor(custB, propB, tech2.id);
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("masking helpers", () => {
  it("keeps only the area line and masks email/phone", () => {
    expect(
      areaLine({ street: "1 Main", city: "Austin", state: "TX", zip: "78701" }),
    ).toBe("Austin, TX 78701");
    expect(areaLine({ street: "1 Main" })).toBeNull();
    expect(
      maskContact({ email: "pat@example.com", phone: "+15125550142" }),
    ).toEqual({ email: "p•••@example.com", phone: "•••• 0142" });
  });
});

describe("T5-05 customer statement", () => {
  it("refuses a customer outside the viewer's scope", async () => {
    auth.user = tech;
    await expect(getStatement(custB)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("masks contact details for a tech outside the contact window", async () => {
    auth.user = tech;
    const s = await getStatement(custA);
    expect(s?.customer.email).toBe("p•••@example.com");
    expect(s?.customer.phone).toBe("•••• 0142");
    expect(s?.customer.addressLines).toEqual(["Austin, TX 78701"]);
  });

  it("shows full details to the office", async () => {
    auth.user = admin;
    const s = await getStatement(custB);
    expect(s?.customer.email).toBe("quinn@example.com");
    expect(s?.customer.addressLines[0]).toBe("100 Congress Ave");
  });
});

describe("T5-11 document masking", () => {
  let invoiceId: string;
  let estimateId: string;
  beforeAll(async () => {
    await db.transaction(async (tx) => {
      ({ invoiceId } = await addJobLine(
        tx,
        jobA,
        { type: "service", name: "Rekey", qty: 1, unitPriceCents: 12_000 },
        actorOf(admin),
      ));
      ({ estimateId } = await createEstimateDraft(
        tx,
        { customerId: custA, jobId: jobA },
        actorOf(admin),
      ));
    });
  });

  it("masks the invoice for a tech outside the window", async () => {
    const doc = await loadInvoiceForViewer(tech, invoiceId);
    expect(doc.customer.email).toBe("p•••@example.com");
    expect(doc.property?.addressLines).toEqual(["Austin, TX 78701"]);
  });

  it("shows the invoice in full to the office", async () => {
    const doc = await loadInvoiceForViewer(admin, invoiceId);
    expect(doc.customer.email).toBe("pat@example.com");
    expect(doc.property?.addressLines[0]).toBe("100 Congress Ave");
  });

  it("masks the estimate for a tech, reveals it inside the window", async () => {
    const masked = await loadEstimateDocForViewer(tech, estimateId);
    expect(masked?.customer.email).toBe("p•••@example.com");
    expect(masked?.propertyLines).toEqual(["Austin, TX 78701"]);
    // Scheduled an hour from now: the window (start − 2h) is open.
    await db
      .update(jobs)
      .set({ scheduledStart: new Date(Date.now() + 3600_000) })
      .where(eq(jobs.id, jobA));
    const open = await loadEstimateDocForViewer(tech, estimateId);
    expect(open?.customer.email).toBe("pat@example.com");
    expect(open?.propertyLines[0]).toBe("100 Congress Ave");
    await db
      .update(jobs)
      .set({ scheduledStart: null })
      .where(eq(jobs.id, jobA));
  });
});

describe("T5-12b signature media binding", () => {
  let estimateId: string;
  beforeAll(async () => {
    ({ estimateId } = await db.transaction((tx) =>
      createEstimateDraft(
        tx,
        { customerId: custA, jobId: jobA },
        actorOf(admin),
      ),
    ));
  });

  const sign = (mediaId: string, actor: Actor) =>
    db.transaction((tx) =>
      captureSignature(
        tx,
        {
          docType: "estimate",
          docId: estimateId,
          docSnapshot: { estimate: estimateId },
          signerName: "Pat Customer",
          signerKind: "customer",
          customerId: custA,
          signatureMediaId: mediaId,
          channel: "remote_link",
          esignConsent: true,
        },
        actor,
      ),
    );

  const rejected = async (p: Promise<unknown>) => {
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fieldErrors.signatureMediaId).toEqual([
      SIGNATURE_MEDIA_ERROR,
    ]);
  };

  it("rejects an image from another job", async () => {
    const other = await signatureMedia({
      jobId: jobB,
      customerId: custB,
      entityType: "job",
      entityId: jobB,
    });
    await rejected(sign(other, PUBLIC_ACTOR));
  });

  it("rejects a photo from the same job", async () => {
    const photo = await signatureMedia({
      kind: "photo",
      tag: "problem",
      jobId: jobA,
    });
    await rejected(sign(photo, PUBLIC_ACTOR));
  });

  it("rejects someone else's unbound upload", async () => {
    const theirs = await signatureMedia({ uploaderId: tech2.id });
    await rejected(sign(theirs, actorOf(tech)));
  });

  it("rejects an image bound to another estimate on the same job", async () => {
    const { estimateId: otherEst } = await db.transaction((tx) =>
      createEstimateDraft(
        tx,
        { customerId: custA, jobId: jobA },
        actorOf(admin),
      ),
    );
    const other = await signatureMedia({
      jobId: jobA,
      customerId: custA,
      entityType: "estimate",
      entityId: otherEst,
    });
    await rejected(sign(other, PUBLIC_ACTOR));
  });

  it("accepts the signer's own upload on a staff device", async () => {
    const mine = await signatureMedia({ uploaderId: tech.id });
    const r = await sign(mine, actorOf(tech));
    expect(r.signatureId).toBeTruthy();
    const [m] = await db
      .select({ locked: media.evidenceLocked })
      .from(media)
      .where(eq(media.id, mine));
    expect(m?.locked).toBe(true);
  });

  it("accepts a magic-link upload for this estimate, once", async () => {
    const pub = await signatureMedia({
      jobId: jobA,
      customerId: custA,
      entityType: "estimate",
      entityId: estimateId,
    });
    expect((await sign(pub, PUBLIC_ACTOR)).signatureId).toBeTruthy();
    await rejected(sign(pub, PUBLIC_ACTOR));
  });
});

describe("T5-19 public upload cap", () => {
  it("refuses presigns once the document holds the maximum files", async () => {
    const { estimateId } = await db.transaction((tx) =>
      createEstimateDraft(tx, { customerId: custB }, actorOf(admin)),
    );
    const { token } = await db.transaction((tx) =>
      mintPublicToken(tx, {
        kind: "estimate",
        entity: { type: "estimate", id: estimateId },
        customerId: custB,
      }),
    );
    const file = {
      clientId: crypto.randomUUID(),
      mime: "image/png" as const,
      bytes: 1000,
      sha256: "a".repeat(64),
      kind: "signature" as const,
    };
    const ok = await publicPresign({ token, file }, "203.0.113.9");
    expect(ok.mediaId).toBeTruthy();
    for (let i = 0; i < MAX_PUBLIC_FILES_PER_DOC; i++)
      await signatureMedia({ entityType: "estimate", entityId: estimateId });
    await expect(
      publicPresign(
        { token, file: { ...file, clientId: crypto.randomUUID() } },
        "203.0.113.9",
      ),
    ).rejects.toMatchObject({ code: "upload_limit" });
  });
});

describe("T1-02 never auto-issue an empty invoice", () => {
  const invoiceOf = async (jobId: string) =>
    (await db.select().from(invoices).where(eq(invoices.jobId, jobId)))[0];
  const paymentStatus = async (jobId: string) =>
    (
      await db
        .select({ s: jobs.paymentStatus })
        .from(jobs)
        .where(eq(jobs.id, jobId))
    )[0]?.s;

  it("leaves an invoice with no lines as a draft on completion", async () => {
    const jobId = await jobFor(custA, propA, tech.id);
    const r = await db.transaction((tx) =>
      issueInvoiceForJob(tx, jobId, "job_completed", SYSTEM_ACTOR),
    );
    expect(r).toBeNull();
    const inv = await invoiceOf(jobId);
    expect(inv?.status).toBe("draft");
    expect(inv?.issuedAt).toBeNull();
    expect(await paymentStatus(jobId)).toBe("none");
  });

  it("refuses a manual issue of an empty invoice", async () => {
    const jobId = await jobFor(custA, propA, tech.id);
    const err = await db
      .transaction(async (tx) => {
        await getOrCreateDraftInvoice(tx, jobId, actorOf(admin));
        return issueInvoiceForJob(tx, jobId, "manual", actorOf(admin));
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fieldErrors.lines).toEqual([
      EMPTY_INVOICE_MESSAGE,
    ]);
  });

  it("an explicit $0 line is a no-charge invoice: paid, job paid", async () => {
    const jobId = await jobFor(custA, propA, tech.id);
    const r = await db.transaction(async (tx) => {
      await addJobLine(
        tx,
        jobId,
        {
          type: "service",
          name: "Warranty visit (no charge)",
          qty: 1,
          unitPriceCents: 0,
        },
        actorOf(admin),
      );
      return issueInvoiceForJob(tx, jobId, "job_completed", SYSTEM_ACTOR);
    });
    expect(r?.totalCents).toBe(0);
    expect((await invoiceOf(jobId))?.status).toBe("paid");
    expect(await paymentStatus(jobId)).toBe("paid");
  });

  it("a priced invoice is issued and the job stays unpaid", async () => {
    const jobId = await jobFor(custA, propA, tech.id);
    await db.transaction(async (tx) => {
      await addJobLine(
        tx,
        jobId,
        { type: "service", name: "Rekey", qty: 1, unitPriceCents: 9_500 },
        actorOf(admin),
      );
      return issueInvoiceForJob(tx, jobId, "job_completed", SYSTEM_ACTOR);
    });
    expect((await invoiceOf(jobId))?.status).toBe("issued");
    expect(await paymentStatus(jobId)).toBe("none");
  });
});

describe("T2-06 approved option total", () => {
  it("lists an approved estimate at the approved option's total", async () => {
    const { customerId } = await customerWithProperty(
      "Rita Ranges",
      "rita@example.com",
    );
    const { estimateId } = await db.transaction((tx) =>
      createEstimateDraft(tx, { customerId }, actorOf(admin)),
    );
    const [good] = await db
      .select({ id: estimateOptions.id })
      .from(estimateOptions)
      .where(eq(estimateOptions.estimateId, estimateId));
    const [better] = await db
      .insert(estimateOptions)
      .values({ estimateId, label: "Better", sort: 1, recommended: false })
      .returning({ id: estimateOptions.id });
    await db.transaction(async (tx) => {
      await insertLines(tx, "estimate_option", good?.id as string, [
        { type: "service", name: "Repair", qty: 1, unitPriceCents: 10_000 },
      ]);
      await insertLines(tx, "estimate_option", better?.id as string, [
        { type: "service", name: "Replace", qty: 1, unitPriceCents: 40_000 },
      ]);
    });
    const total = async () =>
      (await listEstimatesForViewer(admin, { customerId }))[0]?.totalCents;
    expect(await total()).toBe(10_000); // recommended (the first option)
    await db
      .update(estimates)
      .set({ status: "approved", approvedOptionId: better?.id })
      .where(eq(estimates.id, estimateId));
    expect(await total()).toBe(40_000);
    expect((await loadEstimate(estimateId))?.headlineCents).toBe(40_000);
  });
});

describe("T5-09 / T2-15 creating an estimate", () => {
  it("rejects another customer's property", async () => {
    auth.user = admin;
    const r = await createEstimate({
      customer: { customerId: custA, propertyId: propB },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors?.propertyId).toBeTruthy();
  });

  it("needs leads.convert to link a lead", async () => {
    const [l] = await db
      .insert(leads)
      .values({ customerId: custA, propertyId: propA, name: "Pat" })
      .returning({ id: leads.id });
    auth.user = tech;
    const r = await createEstimate({
      customer: { customerId: custA },
      leadId: l?.id,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/permission/i);
    // Nothing was created or booked.
    expect(
      (
        await db
          .select({ s: leads.status })
          .from(leads)
          .where(eq(leads.id, l?.id as string))
      )[0]?.s,
    ).toBe("new");
  });

  it("books the lead when the estimate is sent, not when drafted", async () => {
    const [l] = await db
      .insert(leads)
      .values({ customerId: custA, propertyId: propA, name: "Pat" })
      .returning({ id: leads.id });
    const leadId = l?.id as string;
    auth.user = admin;
    const r = await createEstimate({
      customer: { customerId: custA },
      leadId,
    });
    if (!r.ok || !r.data) throw new Error("create failed");
    const statusOf = async () =>
      (
        await db
          .select({ s: leads.status })
          .from(leads)
          .where(eq(leads.id, leadId))
      )[0]?.s;
    expect(await statusOf()).toBe("new");
    const estimateId = r.data.estimateId;
    await db.transaction(async (tx) => {
      const loaded = await loadEstimate(estimateId, tx);
      if (!loaded) throw new Error("estimate");
      await markEstimateSent(tx, loaded.estimate, "link", actorOf(admin));
    });
    expect(await statusOf()).toBe("booked");
    const [conv] = await execRows<{ n: number }>(
      sql`select count(*)::int as n from events where type = 'lead.converted'
          and payload->>'lead_id' = ${leadId}`,
    );
    expect(Number(conv?.n)).toBe(1);
    expect(
      (
        await db
          .select({ id: leads.convertedEstimateId })
          .from(leads)
          .where(and(eq(leads.id, leadId)))
      )[0]?.id,
    ).toBe(estimateId);
  });
});

describe("photos on an estimate", () => {
  let estimateId: string;
  let problem: string;
  let after: string;
  const photo = async (tag: string) => {
    n++;
    const [m] = await db
      .insert(media)
      .values({
        kind: "photo",
        tag,
        jobId: jobA,
        storageKey: `test/photo-${n}.jpg`,
        mime: "image/jpeg",
      } as never)
      .returning({ id: media.id });
    return m?.id as string;
  };
  const shown = async () => {
    const doc = await loadEstimateDocForViewer(admin, estimateId);
    if (!doc) throw new Error("estimate");
    return doc.problemPhotos.map((p) => p.id);
  };

  beforeAll(async () => {
    problem = await photo("problem");
    after = await photo("after");
    ({ estimateId } = await db.transaction((tx) =>
      createEstimateDraft(
        tx,
        { customerId: custA, jobId: jobA },
        actorOf(admin),
      ),
    ));
  });

  it("shows the job's problem photos by default", async () => {
    expect(await shown()).toContain(problem);
    expect(await shown()).not.toContain(after);
  });

  it("shows the staff's pick, in order", async () => {
    auth.user = admin;
    const r = await setEstimatePhotos({
      estimateId,
      showPhotos: true,
      photoMediaIds: [after, problem],
    });
    expect(r.ok).toBe(true);
    expect(await shown()).toEqual([after, problem]);
  });

  it("attaches no photos when switched off", async () => {
    auth.user = admin;
    const r = await setEstimatePhotos({
      estimateId,
      showPhotos: false,
      photoMediaIds: [after],
    });
    expect(r.ok).toBe(true);
    expect(await shown()).toEqual([]);
  });

  it("can't change the photos once the estimate is closed", async () => {
    await db
      .update(estimates)
      .set({ status: "declined" })
      .where(eq(estimates.id, estimateId));
    auth.user = admin;
    const r = await setEstimatePhotos({
      estimateId,
      showPhotos: true,
      photoMediaIds: [],
    });
    expect(r.ok).toBe(false);
  });
});
