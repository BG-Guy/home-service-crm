// Upload hardening (QA2 NEW-1, NEW-2) on a throwaway PGlite:
//  - assertEntityAccess has a rule per entity type the UI sends and refuses the rest;
//  - /complete checks the stored size and hash (local driver) and refuses a mismatch.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-uploads-test-"),
);
process.env.PGLITE_DIR = path.join(root, "pglite");
process.env.UPLOADS_DIR = path.join(root, "uploads");
process.env.CRM_DISABLE_BACKGROUND = "1";
process.env.CRON_PIGGYBACK = "0";
process.env.AI_PROVIDER = "none";

import { eq } from "drizzle-orm";
import { getStorage } from "@/adapters/storage";
import { base64ToHex, hexToBase64 } from "@/adapters/storage/s3";
import { closeDb, db, ensureDb } from "@/db";
import {
  customers,
  disputes,
  fuelLogs,
  jobAssignments,
  jobs,
  media,
  odometerReadings,
  partPurchases,
  payments,
  properties,
  toolAudits,
  tools,
  vehicles,
} from "@/db/schema";
import "@/db/seed/register";
import { loadSessionUser } from "@/lib/auth/current";
import { acceptInvite, createInvite, signup } from "@/lib/auth/flows";
import { type SessionUser, SYSTEM_ACTOR } from "@/lib/types";
import {
  assertEntityAccess,
  completeUpload,
  presignUploads,
} from "@/lib/uploads";

const PASSWORD = "tangerine-kayak-41";
let admin: SessionUser;
let tech1: SessionUser;
let tech2: SessionUser;

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

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const rid = () => crypto.randomUUID();

/** A job for `techId` (customer, property, assignment) and a manual payment on it. */
async function jobFor(techId: string, n: number) {
  const [c] = await db
    .insert(customers)
    .values({ displayName: `Customer ${n}` })
    .returning({ id: customers.id });
  const [p] = await db
    .insert(properties)
    .values({
      customerId: c?.id as string,
      street: `${100 + n} Oak St`,
      city: "Austin",
      state: "TX",
      zip: "78702",
    })
    .returning({ id: properties.id });
  const [j] = await db
    .insert(jobs)
    .values({
      number: `J-U${n}`,
      customerId: c?.id as string,
      propertyId: p?.id as string,
      title: `Job ${n}`,
    })
    .returning({ id: jobs.id });
  await db
    .insert(jobAssignments)
    .values({ jobId: j?.id as string, userId: techId });
  const [pay] = await db
    .insert(payments)
    .values({
      jobId: j?.id as string,
      customerId: c?.id as string,
      kind: "payment",
      method: "check",
      provider: "manual",
      status: "succeeded",
      amountCents: 10000,
    })
    .returning({ id: payments.id });
  return { jobId: j?.id as string, paymentId: pay?.id as string };
}

const allowed = (u: SessionUser, type: string, id: string) =>
  expect(assertEntityAccess(u, { type, id })).resolves.toBeUndefined();
const denied = (u: SessionUser, type: string, id: string) =>
  expect(assertEntityAccess(u, { type, id })).rejects.toMatchObject({
    code: "forbidden",
  });

beforeAll(async () => {
  await ensureDb();
  const s = await signup({
    companyName: "Uploads Co",
    name: "Ada Admin",
    email: "ada@example.com",
    password: PASSWORD,
    timezone: "America/Chicago",
    state: "tx",
  });
  admin = (await loadSessionUser(s.userId, "s")) as SessionUser;
  tech1 = await invite("Tia Tech", "tia@example.com");
  tech2 = await invite("Max Tech", "max@example.com");
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("upload entity rules (QA2 NEW-1)", () => {
  it("tool_audit: the auditing tech or a reviewer; nobody else, no made-up ids", async () => {
    const [a] = await db
      .insert(toolAudits)
      .values({ userId: tech2.id, dueOn: "2026-10-20" })
      .returning({ id: toolAudits.id });
    const id = a?.id as string;
    await denied(tech1, "tool_audit", id);
    await allowed(tech2, "tool_audit", id);
    await allowed(admin, "tool_audit", id);
    await denied(tech2, "tool_audit", rid());
  });

  it("tool: custody for existing tools; a new tool id needs a tool permission", async () => {
    const [t] = await db
      .insert(tools)
      .values({ name: "Impact driver", currentUserId: tech2.id })
      .returning({ id: tools.id });
    await denied(tech1, "tool", t?.id as string);
    await allowed(tech2, "tool", t?.id as string);
    await allowed(admin, "tool", t?.id as string);
    // New tool form / handoff anchor: the row doesn't exist yet.
    await allowed(tech1, "tool", rid());
  });

  it("vehicle: assigned or fleet; a new vehicle id needs vehicles.manage", async () => {
    const [v] = await db
      .insert(vehicles)
      .values({ nickname: "Van 2", assignedUserId: tech2.id })
      .returning({ id: vehicles.id });
    await denied(tech1, "vehicle", v?.id as string);
    await allowed(tech2, "vehicle", v?.id as string);
    await denied(tech1, "vehicle", rid());
    await allowed(admin, "vehicle", rid());
  });

  it("vehicle logs: planned ids for loggers, existing rows for their owner or the fleet", async () => {
    const [v] = await db
      .insert(vehicles)
      .values({ nickname: "Van 3", assignedUserId: tech2.id })
      .returning({ id: vehicles.id });
    const [f] = await db
      .insert(fuelLogs)
      .values({
        vehicleId: v?.id as string,
        userId: tech2.id,
        gallons: 10,
        totalCents: 4000,
        filledAt: new Date(),
      })
      .returning({ id: fuelLogs.id });
    const [o] = await db
      .insert(odometerReadings)
      .values({
        vehicleId: v?.id as string,
        value: 1000,
        source: "manual",
        recordedBy: tech2.id,
        recordedAt: new Date(),
      } as never)
      .returning({ id: odometerReadings.id });
    await denied(tech1, "fuel", f?.id as string);
    await allowed(tech2, "fuel", f?.id as string);
    await allowed(admin, "fuel", f?.id as string);
    await denied(tech1, "odometer", o?.id as string);
    for (const type of [
      "fuel",
      "odometer",
      "service",
      "inspection",
      "vehicle_issue",
      "document",
    ])
      await allowed(tech1, type, rid());
  });

  it("part_purchase: the purchaser or an approver", async () => {
    const [p] = await db
      .insert(partPurchases)
      .values({
        paidBy: "tech",
        purchaserUserId: tech2.id,
        category: "supplies",
        totalCents: 1000,
      } as never)
      .returning({ id: partPurchases.id });
    await denied(tech1, "part_purchase", p?.id as string);
    await allowed(tech2, "part_purchase", p?.id as string);
    await allowed(admin, "part_purchase", p?.id as string);
  });

  it("payment: staff, or the tech of the payment's job; dispute: disputes.manage", async () => {
    const mine = await jobFor(tech1.id, 1);
    const theirs = await jobFor(tech2.id, 2);
    await allowed(tech1, "payment", mine.paymentId);
    await denied(tech1, "payment", theirs.paymentId);
    await allowed(admin, "payment", theirs.paymentId);
    await denied(admin, "payment", rid());

    const [d] = await db
      .insert(disputes)
      .values({
        paymentId: theirs.paymentId,
        provider: "stripe",
        providerRef: `dp_${rid()}`,
        category: "fraudulent",
        amountCents: 10000,
        status: "needs_response",
      } as never)
      .returning({ id: disputes.id });
    await denied(tech2, "dispute", d?.id as string);
    await allowed(admin, "dispute", d?.id as string);
    await denied(admin, "dispute", rid());
  });

  it("refuses any type without a rule, for admins too", async () => {
    for (const type of ["setting", "settlement", "whatever"])
      await denied(admin, type, rid());
    // …through presign as well (it used to fall through and allow).
    await expect(
      presignUploads(admin, {
        files: [
          {
            name: "x.png",
            mime: "image/png",
            bytes: 4,
            sha256: "a".repeat(64),
            kind: "avatar",
            clientId: rid(),
          },
        ],
        entity: { type: "setting", id: rid() },
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("stored size and hash are checked at complete (QA2 NEW-2)", () => {
  const body = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

  async function presignOne(o: {
    bytes?: number;
    sha256?: string;
    sha256Stored?: string;
    withOriginal?: boolean;
  }) {
    const clientId = rid();
    const [f] = await presignUploads(admin, {
      files: [
        {
          name: "r.png",
          mime: "image/png",
          bytes: o.bytes ?? body.byteLength,
          sha256: o.sha256 ?? sha(body),
          ...(o.sha256Stored ? { sha256Stored: o.sha256Stored } : {}),
          kind: "avatar",
          clientId,
          withOriginal: o.withOriginal,
        },
      ],
      entity: { type: "user", id: admin.id },
    });
    if (!f) throw new Error("presign failed");
    return {
      f,
      input: {
        mediaId: f.mediaId,
        clientId,
        key: f.key,
        originalKey: f.original_key ?? null,
        uploadToken: f.upload_token,
        kind: "avatar" as const,
        mime: "image/png" as const,
        bytes: o.bytes ?? body.byteLength,
        sha256Original: o.sha256 ?? sha(body),
        sha256Stored: o.sha256Stored ?? null,
        entity: { type: "user", id: admin.id },
      },
    };
  }

  it("records the server-side hash of what landed", async () => {
    const { f, input } = await presignOne({ sha256Stored: sha(body) });
    expect(f.upload_token).toMatch(/^v3\./);
    await getStorage().put(f.key, body, "image/png");
    const r = await completeUpload(admin, input);
    expect(r.created).toBe(true);
    const [m] = await db.select().from(media).where(eq(media.id, f.mediaId));
    expect(m).toMatchObject({
      bytes: body.byteLength,
      sha256Stored: sha(body),
      sha256Original: sha(body),
    });
  });

  it("refuses a truncated PUT and deletes it", async () => {
    const { f, input } = await presignOne({ sha256Stored: sha(body) });
    await getStorage().put(f.key, body.slice(0, 5), "image/png");
    await expect(completeUpload(admin, input)).rejects.toMatchObject({
      code: "validation",
      message: "The file didn't upload completely. Try again.",
    });
    expect(await getStorage().head?.(f.key)).toBeNull();
    const rows = await db.select().from(media).where(eq(media.id, f.mediaId));
    expect(rows).toHaveLength(0);
  });

  it("refuses a same-size body that isn't the declared one", async () => {
    const { f, input } = await presignOne({ sha256Stored: sha(body) });
    await getStorage().put(f.key, body.slice().reverse(), "image/png");
    await expect(completeUpload(admin, input)).rejects.toMatchObject({
      code: "validation",
    });
  });

  it("can't swap in another stored hash than the presigned one", async () => {
    const { f, input } = await presignOne({ sha256Stored: sha(body) });
    await getStorage().put(f.key, body, "image/png");
    await expect(
      completeUpload(admin, { ...input, sha256Stored: "f".repeat(64) }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("a kept original must hash to sha256_original", async () => {
    const original = new Uint8Array([9, 9, 9, 9]);
    const bad = await presignOne({
      sha256: sha(original),
      sha256Stored: sha(body),
      withOriginal: true,
    });
    await getStorage().put(bad.f.key, body, "image/png");
    await getStorage().put(
      bad.f.original_key as string,
      new Uint8Array([9, 9, 9]),
      "image/png",
    );
    await expect(completeUpload(admin, bad.input)).rejects.toMatchObject({
      code: "validation",
    });
    const good = await presignOne({
      sha256: sha(original),
      sha256Stored: sha(body),
      withOriginal: true,
    });
    await getStorage().put(good.f.key, body, "image/png");
    await getStorage().put(
      good.f.original_key as string,
      original,
      "image/png",
    );
    expect((await completeUpload(admin, good.input)).created).toBe(true);
  });

  it("an older client without a stored hash still completes (size checked)", async () => {
    const { f, input } = await presignOne({});
    await getStorage().put(f.key, body, "image/png");
    expect((await completeUpload(admin, input)).created).toBe(true);
    const [m] = await db.select().from(media).where(eq(media.id, f.mediaId));
    expect(m?.sha256Stored).toBe(sha(body));
  });
});

describe("S3 checksum header helpers", () => {
  it("hex ↔ base64 round-trips a SHA-256", () => {
    const hex = sha(new Uint8Array([1, 2, 3]));
    expect(base64ToHex(hexToBase64(hex))).toBe(hex);
    expect(base64ToHex("bm90LWEtaGFzaA==")).toBeNull();
  });

  it("signs x-amz-checksum-sha256 into a presigned PUT (S3_CHECKSUM=off skips it)", async () => {
    const env = { ...process.env };
    Object.assign(process.env, {
      S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
      S3_BUCKET: "b",
      S3_ACCESS_KEY_ID: "AKIDEXAMPLE",
      S3_SECRET_ACCESS_KEY: "secret",
    });
    try {
      const { s3StorageProvider } = await import("@/adapters/storage/s3");
      const hex = sha(new Uint8Array([7]));
      const p = await s3StorageProvider.presignPut(
        "media/x.png",
        "image/png",
        1,
        60,
        {
          sha256: hex,
        },
      );
      expect(p.headers["x-amz-checksum-sha256"]).toBe(hexToBase64(hex));
      expect(new URL(p.url).searchParams.get("X-Amz-SignedHeaders")).toContain(
        "x-amz-checksum-sha256",
      );
      process.env.S3_CHECKSUM = "off";
      const off = await s3StorageProvider.presignPut(
        "media/x.png",
        "image/png",
        1,
        60,
        {
          sha256: hex,
        },
      );
      expect(off.headers["x-amz-checksum-sha256"]).toBeUndefined();
    } finally {
      process.env = env;
    }
  });
});
