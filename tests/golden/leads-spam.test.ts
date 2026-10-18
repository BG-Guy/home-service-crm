// ★ Golden: spam scoring, the `_ts` rules, origins, dedupe hash, SLA math, snippets.
import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "@/features/customers/search";
import { dedupeHashOf, originAllowed } from "@/features/leads/intake/process";
import {
  applyTsReview,
  looksGibberish,
  scoreLead,
  signTs,
  TS_MAX_AGE_MS,
  tsVerdict,
  verifyTs,
} from "@/features/leads/intake/spam";
import { slaTone } from "@/features/leads/labels";
import { businessMinutesBetween } from "@/features/leads/sla";
import { buildSnippets } from "@/features/leads/snippets";

const SECRET = "test-secret";
const PK = "pk_live_abc123";
const NOW = Date.parse("2026-10-15T15:00:00Z");

describe("_ts signed render timestamp", () => {
  it("valid when ≥ 3 s and ≤ 24 h old", () => {
    expect(verifyTs(SECRET, PK, signTs(SECRET, PK, NOW - 5_000), NOW)).toBe(
      "ok",
    );
  });
  it("too fast (< 3 s) and expired (> 24 h)", () => {
    expect(verifyTs(SECRET, PK, signTs(SECRET, PK, NOW - 1_000), NOW)).toBe(
      "too_fast",
    );
    expect(
      verifyTs(SECRET, PK, signTs(SECRET, PK, NOW - TS_MAX_AGE_MS - 1), NOW),
    ).toBe("expired");
  });
  it("bound to the key and the secret", () => {
    expect(
      verifyTs(SECRET, "pk_live_other", signTs(SECRET, PK, NOW - 5_000), NOW),
    ).toBe("bad_signature");
    expect(verifyTs("other", PK, signTs(SECRET, PK, NOW - 5_000), NOW)).toBe(
      "bad_signature",
    );
  });
  it("missing / malformed", () => {
    expect(verifyTs(SECRET, PK, null, NOW)).toBe("missing");
    expect(verifyTs(SECRET, PK, "12345", NOW)).toBe("malformed");
  });
});

describe("_ts verdict (SPEC §8.3 step 3)", () => {
  it("plain HTML form without _ts is NOT spam", () => {
    expect(tsVerdict("missing", false)).toEqual({ spam: false, reason: null });
  });
  it("missing _ts is NEVER hard spam; on a require_ts source it goes to Check (QA2 T2-04)", () => {
    expect(tsVerdict("missing", true)).toEqual({
      spam: false,
      reason: null,
      review: "ts_missing",
    });
  });
  it("an expired _ts (tab left open) is a review signal, not spam", () => {
    for (const req of [false, true])
      expect(tsVerdict("expired", req)).toEqual({
        spam: false,
        reason: null,
        review: "ts_expired",
      });
  });
  it("a tampered or too-fast _ts is always hard spam", () => {
    for (const c of ["bad_signature", "too_fast", "malformed"] as const) {
      expect(tsVerdict(c, false)).toEqual({ spam: true, reason: `ts_${c}` });
      expect(tsVerdict(c, true).spam).toBe(true);
    }
  });
  it("a review signal lifts the soft score to at least the Check threshold", () => {
    const clean = { score: 0, reasons: [] as string[] };
    expect(applyTsReview(clean, null, 50)).toEqual(clean);
    expect(applyTsReview(clean, "ts_missing", 50)).toEqual({
      score: 50,
      reasons: ["ts_missing"],
    });
    expect(applyTsReview(clean, "ts_missing", 80).score).toBe(80);
    expect(
      applyTsReview({ score: 70, reasons: ["x"] }, "ts_missing", 50),
    ).toEqual({ score: 100, reasons: ["x", "ts_missing"] });
  });
});

describe("soft spam score (never drops a lead)", () => {
  const clean = {
    name: "Dana Lee",
    phone: "+15125550100",
    phoneIsUs: true,
    email: null,
    notes: "3 locks",
  };
  it("clean lead → 0", () => {
    expect(scoreLead(clean)).toEqual({ score: 0, reasons: [] });
  });
  it.each([
    [{ notes: "a http://x.co b http://y.co c http://z.co" }, 40, "many_urls"],
    [{ phone: null, email: null }, 40, "no_contact"],
    [{ phone: "+442079460958", phoneIsUs: false }, 25, "non_us_phone"],
    [{ name: "xkcdqwzz bbbb" }, 30, "gibberish_name"],
    [{ name: "www.cheap.example" }, 30, "url_in_name"],
  ])("%j → +%d (%s)", (patch, pts, reason) => {
    const r = scoreLead({ ...clean, ...patch });
    expect(r.reasons).toContain(reason);
    expect(r.score).toBeGreaterThanOrEqual(pts);
  });
  it("caps at 100 and crosses the default 50 'Check' threshold", () => {
    const r = scoreLead({
      name: "qwrtzp xkcdm",
      phone: null,
      phoneIsUs: true,
      email: null,
      notes: "http://a.co http://b.co http://c.co",
    });
    expect(r.score).toBe(100);
  });
  it("normal names are not gibberish", () => {
    for (const n of [
      "Dana Lee",
      "María José",
      "O'Brien",
      "Nguyen Thi",
      "Christopher Strickland",
    ])
      expect(looksGibberish(n)).toBe(false);
  });
});

describe("allowed origins", () => {
  it("bare domain also allows www; wildcard allows subdomains; full origin is exact", () => {
    expect(originAllowed(["acme.com"], "https://acme.com", null)).toBe(true);
    expect(originAllowed(["acme.com"], "https://www.acme.com", null)).toBe(
      true,
    );
    expect(originAllowed(["acme.com"], "https://evil.com", null)).toBe(false);
    expect(originAllowed(["acme.com"], "https://acme.com.evil.com", null)).toBe(
      false,
    );
    expect(originAllowed(["*.acme.com"], "https://shop.acme.com", null)).toBe(
      true,
    );
    expect(originAllowed(["https://acme.com"], "http://acme.com", null)).toBe(
      false,
    );
  });
  it("falls back to Referer; no origin at all is refused when a list exists", () => {
    expect(originAllowed(["acme.com"], null, "https://acme.com/contact")).toBe(
      true,
    );
    expect(originAllowed(["acme.com"], "null", null)).toBe(false);
    expect(originAllowed([], null, null)).toBe(true);
  });
});

describe("dedupe hash", () => {
  it("phone + service, case-insensitive; email when no phone; null without contact", () => {
    expect(dedupeHashOf("+15125550100", null, "Lockout")).toBe(
      dedupeHashOf("+15125550100", "x@y.z", " lockout "),
    );
    expect(dedupeHashOf("+15125550100", null, "Rekey")).not.toBe(
      dedupeHashOf("+15125550100", null, "Lockout"),
    );
    expect(dedupeHashOf(null, "a@b.co", null)).toMatch(/^[0-9a-f]{64}$/);
    expect(dedupeHashOf(null, null, "x")).toBeNull();
  });
});

describe("SLA", () => {
  it("timer tones: green < 5, amber < 15, red beyond", () => {
    expect(slaTone(4.9)).toBe("green");
    expect(slaTone(5)).toBe("orange");
    expect(slaTone(14.9)).toBe("orange");
    expect(slaTone(15)).toBe("red");
  });
  it("business-hours minutes skip the night", () => {
    const hours = [1, 2, 3, 4, 5].map((day) => ({
      day,
      open: "08:00",
      close: "17:00",
    }));
    // Thu 2026-10-15 16:50 CDT → Fri 08:10 CDT = 10 + 10 business minutes.
    const from = new Date("2026-10-15T21:50:00Z");
    const to = new Date("2026-10-16T13:10:00Z");
    expect(businessMinutesBetween(from, to, hours, "America/Chicago")).toBe(20);
    // Saturday: closed.
    expect(
      businessMinutesBetween(
        new Date("2026-10-17T15:00:00Z"),
        new Date("2026-10-17T18:00:00Z"),
        hours,
        "America/Chicago",
      ),
    ).toBe(0);
  });
});

describe("snippets (§8.5)", () => {
  const s = buildSnippets({
    appUrl: "https://crm.example.com/",
    publicKey: "pk_live_ab12cd34",
    companyName: "ACME",
    consentText:
      "I agree to receive text messages about my request. Reply STOP to opt out.",
    services: ["Lockout", "Rekey"],
  });
  it("plain form posts to the form endpoint with the real key, honeypot and an optional, unchecked consent box", () => {
    expect(s.plainForm).toContain(
      'action="https://crm.example.com/api/v1/leads/f/pk_live_ab12cd34"',
    );
    expect(s.plainForm).toContain('name="company_website"');
    const consent =
      s.plainForm?.split("\n").find((l) => l.includes("sms_consent")) ?? "";
    expect(consent).not.toMatch(/checked|required/);
    expect(consent).toContain("from ACME");
  });
  it("JS level adds data-crm-lead and the script tag", () => {
    expect(s.jsSnippet).toContain("data-crm-lead");
    expect(s.scriptTag).toBe(
      '<script src="https://crm.example.com/embed.js" data-key="pk_live_ab12cd34" defer></script>',
    );
  });
  it("API level is a curl with a bearer secret", () => {
    expect(s.curl).toContain("https://crm.example.com/api/v1/leads");
    expect(s.curl).toContain("Authorization: Bearer sk_live_");
  });
});

describe("global search query parsing (phone formats)", () => {
  it.each([
    ["(512) 555-0100", "+15125550100"],
    ["512.555.0100", "+15125550100"],
    ["+1 512 555 0100", "+15125550100"],
    ["5125550100", "+15125550100"],
  ])("%s → %s", (q, e164) => {
    expect(parseSearchQuery(q)?.e164).toBe(e164);
  });
  it("partial digits are a prefix search, not E.164", () => {
    const p = parseSearchQuery("555-01");
    expect(p?.e164).toBeNull();
    expect(p?.digits).toBe("55501");
  });
  it("job and invoice numbers", () => {
    expect(parseSearchQuery("J-1042")?.number).toBe("1042");
    expect(parseSearchQuery("1042")?.number).toBe("1042");
    expect(parseSearchQuery("x")).toBeNull();
  });
});
