import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkPolicy, findPii } from "@/adapters/ai/policy";
import { buildSmsHref, buildWhatsAppHref } from "@/adapters/messaging/href";
import {
  normalizeStripeEvent,
  toForm,
  verifyStripeSignature,
} from "@/adapters/payments/stripe";
import { isSafeKey, mediaKeys } from "@/adapters/storage/keys";
import { flattenZodError, formDataToObject } from "@/lib/action";
import {
  formatSessionCookie,
  parseSessionCookie,
  sessionCookieName,
} from "@/lib/auth/cookie-name";
import {
  checkPasswordPolicy,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "@/lib/auth/password";
import { isPublicPath } from "@/lib/auth/public-paths";
import { safeNextPath } from "@/lib/auth/safe-next";
import { dueThreshold, isDue, mostRecentOccurrence } from "@/lib/cron";
import { decrypt, encrypt } from "@/lib/crypto";
import { deepMerge, parseSettings } from "@/lib/settings";
import { uploadPermsFor } from "@/lib/uploads";
import { timezoneForZip } from "@/lib/zip-tz";

describe("password hashing (SPEC M01)", () => {
  it("argon2id PHC round trip with the spec parameters", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/,
    );
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong horse battery", h)).toBe(false);
    expect(needsRehash(h)).toBe(false);
    expect(needsRehash(h.replace("t=2", "t=1"))).toBe(true);
    expect(await verifyPassword("x", "garbage")).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
  });

  it("policy: ≥ 10 chars, not common, not derived from identity", () => {
    expect(checkPasswordPolicy("short")).toMatch(/at least 10/);
    expect(checkPasswordPolicy("password123")).toMatch(/too common/);
    expect(checkPasswordPolicy("Password2024!")).toMatch(/too common/);
    expect(checkPasswordPolicy("aaaaaaaaaaaa")).toMatch(/too simple/);
    expect(checkPasswordPolicy("1234567890")).toBeTruthy();
    expect(
      checkPasswordPolicy("acmeplumbing", { company: "Acme Plumbing" }),
    ).toBeNull();
    expect(
      checkPasswordPolicy("rekeyers2026", { company: "Acme Rekeyers" }),
    ).toMatch(/name, email or company/);
    expect(checkPasswordPolicy("tangerine-kayak-41")).toBeNull();
  });
});

describe("session cookie (amendment 5)", () => {
  it("names __Host-sid in production, sid in development", () => {
    expect(sessionCookieName(true)).toBe("__Host-sid");
    expect(sessionCookieName(false)).toBe("sid");
  });
  it("round-trips the remember flag", () => {
    const token = "A".repeat(43);
    expect(parseSessionCookie(formatSessionCookie(token, true))).toEqual({
      remember: true,
      token,
    });
    expect(parseSessionCookie(formatSessionCookie(token, false))).toEqual({
      remember: false,
      token,
    });
    expect(parseSessionCookie("x.bad")).toBeNull();
    expect(parseSessionCookie(undefined)).toBeNull();
  });
  it("public paths skip the login redirect", () => {
    for (const p of [
      "/login",
      "/signup",
      "/invite/abc",
      "/reset",
      "/reset/tok",
      "/j/tok",
      "/i/tok",
      "/f/pk_1",
      "/privacy",
    ])
      expect(isPublicPath(p), p).toBe(true);
    for (const p of [
      "/",
      "/today",
      "/jobs/1",
      "/settings",
      "/insights",
      "/loginx",
      "/jobs",
    ])
      expect(isPublicPath(p), p).toBe(false);
  });
});

describe("settings parsing", () => {
  it("fills defaults and keeps valid stored values", () => {
    const s = parseSettings({
      jobs: { arrival_radius_m: 500 },
      features: { tools: true },
    });
    expect(s.jobs.arrival_radius_m).toBe(500);
    expect(s.jobs.default_window_min).toBe(60);
    expect(s.features.tools).toBe(true);
    expect(s.features.inventory).toBe(false);
    expect(s.auth.open_signup).toBe(false);
    expect(s.compliance.quiet_hours).toEqual({ start: "08:00", end: "20:00" });
    expect(s.vehicles.policies.service.approval).toBe("always_review");
    expect(s.parts.markup_tiers[0]).toEqual({ lt: 2000, mult: 4 });
  });
  it("resets only the invalid keys of a namespace", () => {
    const s = parseSettings({
      jobs: { arrival_radius_m: "far", default_window_min: 120 },
    });
    expect(s.jobs.arrival_radius_m).toBe(300);
    expect(s.jobs.default_window_min).toBe(120);
  });
  it("deepMerge replaces arrays and merges objects", () => {
    expect(
      deepMerge({ a: { b: 1, c: [1, 2] }, d: 1 }, { a: { c: [3] }, e: 2 }),
    ).toEqual({ a: { b: 1, c: [3] }, d: 1, e: 2 });
  });
});

describe("cron windows (company TZ)", () => {
  const tz = "America/Chicago";
  it("dailyAt: most recent 03:00 ≤ now", () => {
    const now = new Date("2026-10-15T10:00:00Z"); // 05:00 CDT
    expect(
      mostRecentOccurrence({ dailyAt: "03:00" }, now, tz)?.toISOString(),
    ).toBe("2026-10-15T08:00:00.000Z");
    const early = new Date("2026-10-15T07:00:00Z"); // 02:00 CDT → yesterday 03:00
    expect(
      mostRecentOccurrence({ dailyAt: "03:00" }, early, tz)?.toISOString(),
    ).toBe("2026-10-14T08:00:00.000Z");
  });
  it("runs at most once per window", () => {
    const now = new Date("2026-10-15T10:00:00Z");
    expect(isDue({ dailyAt: "03:00" }, now, null, tz)).toBe(true);
    expect(
      isDue({ dailyAt: "03:00" }, now, new Date("2026-10-15T08:05:00Z"), tz),
    ).toBe(false);
    expect(
      isDue({ dailyAt: "03:00" }, now, new Date("2026-10-14T08:05:00Z"), tz),
    ).toBe(true);
  });
  it("everyMinutes with 5 s slack", () => {
    const now = new Date("2026-10-15T10:00:00Z");
    expect(
      isDue({ everyMinutes: 5 }, now, new Date("2026-10-15T09:55:03Z"), tz),
    ).toBe(true);
    expect(
      isDue({ everyMinutes: 5 }, now, new Date("2026-10-15T09:56:00Z"), tz),
    ).toBe(false);
    expect(dueThreshold({ everyMinutes: 1 }, now, tz).toISOString()).toBe(
      "2026-10-15T09:59:05.000Z",
    );
  });
  it("weekly and monthly", () => {
    const thu = new Date("2026-10-15T15:00:00Z"); // Thu 10:00 CDT
    expect(
      mostRecentOccurrence(
        { weeklyAt: { day: 1, time: "06:00" } },
        thu,
        tz,
      )?.toISOString(),
    ).toBe("2026-10-12T11:00:00.000Z");
    expect(
      mostRecentOccurrence(
        { monthlyAt: { day: 20, time: "06:00" } },
        thu,
        tz,
      )?.toISOString(),
    ).toBe("2026-09-20T11:00:00.000Z");
  });
});

describe("crypto, zip→tz, storage keys", () => {
  it("AES-GCM v1 round trip", () => {
    const c = encrypt("1234-gate");
    expect(c).toMatch(/^v1:[\w-]+:[\w-]*:[\w-]+$/);
    expect(decrypt(c)).toBe("1234-gate");
    // Tamper with the first char of the last segment: every bit of it is
    // significant (the last char of a 16-byte base64url value carries
    // padding bits, so flipping it can decode to the same bytes).
    const parts = c.split(":");
    const last = parts[3] as string;
    parts[3] = (last[0] === "A" ? "B" : "A") + last.slice(1);
    expect(() => decrypt(parts.join(":"))).toThrow();
  });
  it("maps ZIPs to zones incl. split states", () => {
    expect(timezoneForZip("78701")).toBe("America/Chicago");
    expect(timezoneForZip("79901")).toBe("America/Denver");
    expect(timezoneForZip("10001")).toBe("America/New_York");
    expect(timezoneForZip("94103")).toBe("America/Los_Angeles");
    expect(timezoneForZip("85001")).toBe("America/Phoenix");
    expect(timezoneForZip("32501")).toBe("America/Chicago");
    expect(timezoneForZip("96813")).toBe("Pacific/Honolulu");
    expect(timezoneForZip("99501")).toBe("America/Anchorage");
    expect(timezoneForZip("12")).toBeNull();
  });
  it("builds safe media keys", () => {
    const k = mediaKeys("abc", "image/jpeg", new Date("2026-03-05T00:00:00Z"));
    expect(k).toEqual({
      key: "media/2026/03/abc.jpg",
      thumbKey: "media/2026/03/abc_thumb.webp",
      originalKey: "media/2026/03/abc_orig.jpg",
    });
    expect(isSafeKey(k.key)).toBe(true);
    expect(isSafeKey("../etc/passwd")).toBe(false);
    expect(isSafeKey("/abs")).toBe(false);
    expect(isSafeKey("a//b")).toBe(false);
  });
});

describe("adapters", () => {
  it("sms/whatsapp deep links", () => {
    expect(buildSmsHref("+15125550100", "Hi & bye")).toBe(
      "sms:+15125550100?&body=Hi%20%26%20bye",
    );
    expect(buildWhatsAppHref("+1 512 555 0100", "Hi")).toBe(
      "https://wa.me/15125550100?text=Hi",
    );
  });
  it("stripe form encoding and webhook signatures", () => {
    expect(
      toForm({ a: 1, b: { c: "x", d: [{ e: 2 }] }, z: null }).toString(),
    ).toBe("a=1&b%5Bc%5D=x&b%5Bd%5D%5B0%5D%5Be%5D=2");
    const body = JSON.stringify({
      id: "evt_1",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_1",
          status: "succeeded",
          amount: 1000,
          amount_received: 1000,
          metadata: { invoice_id: "inv" },
        },
      },
    });
    const t = 1_800_000_000;
    const sig = createHmac("sha256", "whsec_test")
      .update(`${t}.${body}`)
      .digest("hex");
    expect(
      verifyStripeSignature(body, `t=${t},v1=${sig}`, "whsec_test", t + 10),
    ).toBe(true);
    expect(
      verifyStripeSignature(body, `t=${t},v1=${sig}`, "whsec_test", t + 301),
    ).toBe(false);
    expect(
      verifyStripeSignature(`${body} `, `t=${t},v1=${sig}`, "whsec_test", t),
    ).toBe(false);
    const [evt] = normalizeStripeEvent(JSON.parse(body));
    expect(evt).toMatchObject({
      type: "payment.succeeded",
      invoiceId: "inv",
      payment: { ref: "pi_1", amountCents: 1000, status: "succeeded" },
    });
    expect(
      normalizeStripeEvent({ type: "customer.created", data: { object: {} } }),
    ).toEqual([]);
  });
  it("AI policy: free tier refuses documents and PII prompts", () => {
    expect(checkPolicy({ kind: "receipt", tier: "free" }).ok).toBe(true);
    expect(
      checkPolicy({ kind: "receipt", tier: "free", isDocument: true }).ok,
    ).toBe(false);
    expect(
      checkPolicy({
        kind: "explain_flags",
        tier: "free",
        prompt: "Call Dana at 512-555-0100",
      }).ok,
    ).toBe(false);
    expect(findPii("12 Oak St, dana@example.com")).toEqual([
      "email",
      "street address",
    ]);
    expect(
      checkPolicy({
        kind: "maintenance_suggest",
        tier: "paid",
        prompt: "Call Dana at 512-555-0100",
      }).ok,
    ).toBe(true);
  });
});

describe("action helpers", () => {
  it("formDataToObject nests dotted keys and collects arrays", () => {
    const fd = new FormData();
    fd.append("name", "Dana");
    fd.append("customer.customerId", "c1");
    fd.append("customer.propertyId", "p1");
    fd.append("tags[]", "a");
    fd.append("tags[]", "b");
    fd.append("dup", "1");
    fd.append("dup", "2");
    fd.append("$ACTION_ID_abc", "");
    expect(formDataToObject(fd)).toEqual({
      name: "Dana",
      customer: { customerId: "c1", propertyId: "p1" },
      tags: ["a", "b"],
      dup: ["1", "2"],
    });
  });
  it("flattenZodError keys by path", () => {
    const r = z
      .object({ a: z.object({ b: z.number() }), c: z.string() })
      .safeParse({ a: { b: "x" } });
    expect(r.success).toBe(false);
    if (!r.success)
      expect(Object.keys(flattenZodError(r.error)).sort()).toEqual([
        "a.b",
        "c",
      ]);
  });
  it("upload permissions per kind/tag", () => {
    expect(uploadPermsFor("photo", "before", "job")).toEqual(["photos.upload"]);
    expect(uploadPermsFor("photo", "odometer", null)).toEqual(["vehicles.log"]);
    expect(uploadPermsFor("receipt", "receipt", "job")).toContain(
      "parts.submit_receipt",
    );
    expect(uploadPermsFor("signature", "signature", null)).toBe("any");
    expect(uploadPermsFor("logo", null, null)).toEqual(["settings.manage"]);
  });
});

describe("F5 hardening", () => {
  it("formDataToObject ignores prototype-polluting keys", () => {
    const fd = new FormData();
    fd.append("__proto__.polluted", "yes");
    fd.append("a.constructor.prototype.polluted", "yes");
    fd.append("ok", "1");
    const out = formDataToObject(fd);
    expect(out).toEqual({ ok: "1" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("safeNextPath rejects open redirects", () => {
    expect(safeNextPath("/settings/company?x=1")).toBe("/settings/company?x=1");
    expect(safeNextPath(["/jobs"])).toBe("/jobs");
    for (const bad of [
      "//evil.com",
      "/\\evil.com",
      "/\tevil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      "https://evil.com",
      "evil.com",
      "",
      null,
    ])
      expect(safeNextPath(bad)).toBeNull();
  });

  it("deepMerge skips __proto__ keys", () => {
    const patch = JSON.parse('{"__proto__":{"polluted":true},"a":1}');
    const out = deepMerge({ a: 0 } as Record<string, unknown>, patch);
    expect(out).toEqual({ a: 1 });
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });
});
