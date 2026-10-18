// ★ Golden: lead payload normalizer (SPEC M04 tolerant schema, §8.3 step 4).
import { describe, expect, it } from "vitest";
import {
  applyMapping,
  getPath,
  normalizeLeadPayload,
  parseLeadDate,
  parsePrice,
  truthy,
} from "@/features/leads/intake/normalize";
import { applyPreset, PRESET_SAMPLES } from "@/features/leads/intake/presets";
import { matchServiceType } from "@/features/leads/intake/service-match";

const TZ = "America/Chicago";
const norm = (p: Record<string, unknown>) =>
  normalizeLeadPayload(p, { tz: TZ });

describe("aliases", () => {
  it.each([
    [{ full_name: "Dana Lee" }, "name", "Dana Lee"],
    [{ "your-name": "Dana Lee" }, "name", "Dana Lee"],
    [{ tel: "512-555-0100" }, "phone", "+15125550100"],
    [{ phone_number: "(512) 555-0100" }, "phone", "+15125550100"],
    [{ Email: "Dana@Example.COM" }, "email", "dana@example.com"],
    [{ job_type: "Rekey" }, "service", "Rekey"],
    [{ service_type: "Lockout" }, "service", "Lockout"],
    [{ message: "3 locks" }, "notes", "3 locks"],
    [{ comments: "call after 5" }, "notes", "call after 5"],
    [{ budget: "$300" }, "priceCents", 30000],
    [{ appointment_date: "2026-10-20" }, "preferredDate", "2026-10-20"],
    [{ preferred_window: "morning" }, "preferredWindow", "morning"],
  ])("%j → %s", (payload, key, want) => {
    expect(
      (norm(payload).lead as unknown as Record<string, unknown>)[key],
    ).toBe(want);
  });

  it("first_name + last_name → name", () => {
    const { lead } = norm({ first_name: "Dana", last_name: "Lee" });
    expect(lead.name).toBe("Dana Lee");
    expect(lead.firstName).toBe("Dana");
    expect(lead.lastName).toBe("Lee");
  });

  it("street, city, state, zip → address; one-line address is parsed", () => {
    expect(
      norm({
        street: "12 Oak St",
        city: "Austin",
        state: "tx",
        zip: "78701-1234",
      }).lead.address,
    ).toEqual({
      street: "12 Oak St",
      unit: null,
      city: "Austin",
      state: "TX",
      zip: "78701",
    });
    const one = norm({ address: "12 Oak St, Austin, TX 78701" }).lead.address;
    expect(one).toMatchObject({
      street: "12 Oak St",
      city: "Austin",
      state: "TX",
      zip: "78701",
    });
  });
});

describe("price", () => {
  it.each([
    ["$1,200", 120000],
    ["1200", 120000],
    ["1200.50", 120050],
    ["USD 149", 14900],
    [149, 14900],
    ["", null],
  ])("%j → %j cents", (v, want) => {
    expect(parsePrice(v)).toBe(want);
  });
  it("unparseable → field error (JSON API answers 400)", () => {
    expect(parsePrice("call me")).toBe("invalid");
    expect(norm({ price: "call me" }).errors.price).toBeTruthy();
  });
});

describe("dates in the company time zone", () => {
  it.each([
    ["2026-10-20", "2026-10-20"],
    ["10/20/2026", "2026-10-20"],
    ["1/5/27", "2027-01-05"],
    ["2026-10-20T15:00", "2026-10-20"],
    // 02:00 UTC on the 21st is 21:00 on the 20th in Chicago (CDT).
    ["2026-10-21T02:00:00Z", "2026-10-20"],
    ["2026-10-21T08:00:00+05:00", "2026-10-20"],
  ])("%s → %s", (v, want) => {
    expect(parseLeadDate(v, TZ)).toBe(want);
  });
  it.each(["13/45/2026", "2026-02-30", "next tuesday"])("%s → invalid", (v) => {
    expect(parseLeadDate(v, TZ)).toBe("invalid");
  });
});

describe("phones → E.164", () => {
  it.each([
    ["(512) 555-0100", "+15125550100", true],
    ["512.555.0100", "+15125550100", true],
    ["+1 512 555 0100", "+15125550100", true],
    ["15125550100", "+15125550100", true],
    ["+44 20 7946 0958", "+442079460958", false],
  ])("%s → %s", (raw, e164, us) => {
    const { lead } = norm({ phone: raw });
    expect(lead.phone).toBe(e164);
    expect(lead.phoneIsUs).toBe(us);
  });
  it("invalid phone → error + warning, raw kept", () => {
    const r = norm({ phone: "12" });
    expect(r.lead.phone).toBeNull();
    expect(r.lead.phoneRaw).toBe("12");
    expect(r.errors.phone).toBeTruthy();
  });
});

describe("consent truthiness", () => {
  it.each([
    "on",
    "true",
    "1",
    "yes",
    "YES",
    "Yes",
    "checked",
    true,
    1,
  ])("%j → true", (v) => {
    expect(truthy(v)).toBe(true);
    expect(norm({ sms_consent: v }).lead.smsConsent).toBe(true);
  });
  it.each([
    "",
    "no",
    "0",
    "off",
    "false",
    false,
    0,
    null,
    undefined,
  ])("%j → false", (v) => {
    expect(truthy(v)).toBe(false);
  });
  it("marketing consent is separate", () => {
    const { lead } = norm({ sms_consent: "on" });
    expect(lead.marketingConsent).toBe(false);
  });
});

describe("unknown fields, attribution, extras", () => {
  it("unknown fields → extra; utm/gclid → attribution", () => {
    const { lead } = norm({
      name: "Dana",
      favorite_color: "blue",
      utm_source: "google",
      utm_campaign: "fall",
      gclid: "abc",
      first_touch: JSON.stringify({
        utm_source: "facebook",
        at: "2026-09-01T00:00:00Z",
      }),
    });
    expect(lead.extra).toEqual({ favorite_color: "blue" });
    expect(lead.attribution).toMatchObject({
      utm_source: "google",
      utm_campaign: "fall",
      gclid: "abc",
      first_touch: { utm_source: "facebook" },
    });
  });
  it("honeypot, _ts and test flag are recognized", () => {
    const { lead } = norm({ company_website: "x", _ts: "1.y", test: "true" });
    expect(lead.honeypot).toBe("x");
    expect(lead.ts).toBe("1.y");
    expect(lead.isTest).toBe(true);
  });
});

describe("source JSON-path mapping", () => {
  const raw = {
    data: {
      customer: { displayName: "Dana Lee", phones: [{ number: "5125550100" }] },
    },
    answers: [{ key: "SERVICE", value: "Rekey" }],
  };
  it("getPath resolves dotted, indexed and [KEY] selectors", () => {
    expect(getPath(raw, "data.customer.displayName")).toBe("Dana Lee");
    expect(getPath(raw, "$.data.customer.phones[0].number")).toBe("5125550100");
    expect(getPath(raw, "answers[SERVICE]")).toBe("Rekey");
    expect(getPath(raw, "nope.x")).toBeUndefined();
  });
  it("mapping overrides aliases and reports missing paths", () => {
    const m = applyMapping({ name: "Alias Name" }, raw, {
      "customer.displayName": "data.customer.displayName",
      phone: "data.customer.phones[0].number",
      service: "answers[SERVICE]",
      email: "data.customer.email",
    });
    expect(m.missing).toEqual(["email"]);
    const { lead } = norm(m.payload);
    expect(lead.name).toBe("Dana Lee");
    expect(lead.phone).toBe("+15125550100");
    expect(lead.service).toBe("Rekey");
  });
});

describe("presets", () => {
  it("thumbtack: customer + request + leadPrice", () => {
    const p = applyPreset("thumbtack", PRESET_SAMPLES.thumbtack);
    expect(p.sourceCostCents).toBe(2200);
    const { lead } = norm(p.payload);
    expect(lead).toMatchObject({
      name: "Dana Lee",
      phone: "+15125557788",
      service: "Locksmith",
      externalId: "tt-1234",
    });
    expect(lead.address).toBeNull(); // zip only
  });
  it("angi: first/last + task name", () => {
    const { lead } = norm(applyPreset("angi", PRESET_SAMPLES.angi).payload);
    expect(lead).toMatchObject({
      name: "Dana Lee",
      service: "Rekey Locks",
      externalId: "998877",
    });
  });
  it("google ads lead form: column ids, google_key, test flag", () => {
    const p = applyPreset(
      "google_ads_leadform",
      PRESET_SAMPLES.google_ads_leadform,
    );
    expect(p.googleKey).toBe("your-google-key");
    expect(p.isTest).toBe(true);
    const { lead } = norm(p.payload);
    expect(lead).toMatchObject({
      name: "Dana Lee",
      phone: "+15125557788",
      externalId: "gl-1",
    });
    expect(lead.attribution).toMatchObject({
      utm_source: "google",
      utm_medium: "lead_form",
    });
  });
  it("make: nested data is flattened", () => {
    const { lead } = norm(applyPreset("make", PRESET_SAMPLES.make).payload);
    expect(lead.name).toBe("Dana Lee");
  });
});

describe("fuzzy service match", () => {
  const types = [
    { id: "a", name: "Lockout", aliases: ["locked out", "lock out"] },
    { id: "b", name: "Garage Door Spring", aliases: [] },
    { id: "c", name: "Old", aliases: [], active: false },
  ];
  it.each([
    ["lockout", "a"],
    ["Locked Out", "a"],
    ["lock-out", "a"],
    ["garage door spring", "b"],
    ["GarageDoorSpring", "b"],
    ["old", null],
    ["plumbing", null],
  ])("%s → %s", (text, id) => {
    expect(matchServiceType(text, types)).toBe(id);
  });
});
