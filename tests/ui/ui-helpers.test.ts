import { describe, expect, it } from "vitest";
import { parseExif } from "@/client/exif";
import { smsHref, waHref } from "@/client/sms-href";
import {
  DEPOSIT_STATUSES,
  DISPUTE_STATUSES,
  ESTIMATE_STATUSES,
  INVOICE_STATUSES,
  JOB_STATUSES,
  LEAD_STATUSES,
  PAYMENT_STATUSES,
  SETTLEMENT_STATUSES,
} from "@/db/enums";
import { initials } from "@/ui/components/Avatar";
import {
  applyPhoneEdit,
  caretAfterDigits,
  formatPhoneInput,
} from "@/ui/format/phone";
import { iconFor, icons } from "@/ui/icons";
import { createVelocityTracker, solveSpring } from "@/ui/motion/spring-driver";
import { ios, project, rubberBand, spring } from "@/ui/motion/springs";
import { STATUS, statusDef } from "@/ui/status";
import { hashString, toneFor } from "@/ui/tone";

describe("springs", () => {
  it("converts Apple duration/bounce to stiffness/damping", () => {
    const s = ios(0.5);
    expect(s.stiffness).toBeCloseTo(((2 * Math.PI) / 0.5) ** 2);
    // bounce 0 → critically damped: c = 2√(km)
    expect(s.damping).toBeCloseTo(2 * Math.sqrt(s.stiffness));
  });
  it("projects a flick with UIScrollView deceleration", () => {
    expect(project(100, 0)).toBe(100);
    expect(project(0, 1000)).toBeCloseTo(499, 0);
  });
  it("rubber-bands with diminishing returns", () => {
    expect(rubberBand(0, 100)).toBe(0);
    expect(rubberBand(50, 100)).toBeLessThan(50);
    expect(rubberBand(10_000, 100)).toBeLessThan(100);
    expect(rubberBand(-50, 100)).toBeCloseTo(-rubberBand(50, 100));
  });
});

describe("spring driver", () => {
  for (const [name, s] of Object.entries(spring)) {
    it(`${name} starts at from, carries velocity, settles at to`, () => {
      const f = solveSpring(300, 0, -2000, s);
      expect(f(0).x).toBeCloseTo(300);
      expect(f(0).v).toBeCloseTo(-2000);
      const end = f(3);
      expect(Math.abs(end.x)).toBeLessThan(0.5);
      expect(Math.abs(end.v)).toBeLessThan(10);
    });
  }
  it("overdamped branch also settles", () => {
    const f = solveSpring(0, 100, 0, ios(0.4, -0.5));
    expect(f(0).x).toBeCloseTo(0);
    expect(f(4).x).toBeCloseTo(100, 0);
  });
  it("bouncy spring overshoots, smooth does not", () => {
    const peak = (s: typeof spring.bouncy) => {
      const f = solveSpring(0, 100, 0, s);
      let max = 0;
      for (let t = 0; t < 2; t += 0.005) max = Math.max(max, f(t).x);
      return max;
    };
    expect(peak(spring.bouncy)).toBeGreaterThan(100);
    expect(peak(spring.smooth)).toBeLessThanOrEqual(100.0001);
  });
  it("velocity tracker returns 0 for a single sample", () => {
    const t = createVelocityTracker();
    t.add(10, performance.now());
    expect(t.velocity()).toBe(0);
  });
});

describe("phone as-you-type", () => {
  it.each([
    ["", ""],
    ["5", "5"],
    ["555", "555"],
    ["5551", "(555) 1"],
    ["555123", "(555) 123"],
    ["5551234", "(555) 123-4"],
    ["5551234567", "(555) 123-4567"],
    ["15551234567", "1 (555) 123-4567"],
    // A leading 1 isn't a country code until there are 11 digits (QA2 office).
    ["1", "1"],
    ["12", "12"],
    ["123", "123"],
    ["1234", "(123) 4"],
    ["1555123456", "(155) 512-3456"],
    ["+1", "+1"],
    ["+1555", "+1 (555)"],
    ["+15551234567", "+1 (555) 123-4567"],
    ["+442079460958", "+442079460958"],
    ["(555) 123-45678", "55512345678"],
  ])("%s → %s", (input, out) => {
    expect(formatPhoneInput(input)).toBe(out);
  });
  it("places the caret after the same digit", () => {
    expect(caretAfterDigits("(555) 123-4567", 4)).toBe(7);
    expect(caretAfterDigits("+1 (555)", 0)).toBe(1);
  });
  it("backspace over a separator deletes the digit before it", () => {
    // "(555) 1|" → user deletes ")"-adjacent space: simulate removing the space
    const prev = "(555) 1";
    const next = "(555)1"; // space removed, caret at 5
    const r = applyPhoneEdit(prev, next, 5);
    expect(r.value.replace(/\D/g, "")).toBe("551");
  });
  it("typing a digit keeps the caret after it", () => {
    const r = applyPhoneEdit("(555) 12", "(555) 123", 9);
    expect(r.value).toBe("(555) 123");
    expect(r.caret).toBe(9);
  });
});

describe("status map", () => {
  const cover = (kind: keyof typeof STATUS, values: readonly string[]) => {
    for (const v of values) expect(statusDef(kind, v).label).not.toBe("");
    for (const v of values)
      expect((STATUS[kind] as Record<string, unknown>)[v]).toBeDefined();
  };
  it("covers every enum value", () => {
    cover("job", JOB_STATUSES);
    cover("lead", LEAD_STATUSES);
    cover("estimate", ESTIMATE_STATUSES);
    cover("invoice", INVOICE_STATUSES);
    cover("payment", PAYMENT_STATUSES);
    cover("deposit", DEPOSIT_STATUSES);
    cover("dispute", DISPUTE_STATUSES);
    cover("settlement", SETTLEMENT_STATUSES);
  });
  it("degrades unknown values to a humanized gray label", () => {
    expect(statusDef("job", "waiting_on_parts")).toEqual({
      label: "Waiting on parts",
      tone: "gray",
    });
  });
});

describe("misc", () => {
  it("initials", () => {
    expect(initials("Maria José Ortega")).toBe("MO");
    expect(initials("acme")).toBe("A");
    expect(initials("  ")).toBe("?");
  });
  it("deterministic tones", () => {
    expect(toneFor("user-1")).toBe(toneFor("user-1"));
    expect(hashString("a")).not.toBe(hashString("b"));
  });
  it("icon lookup falls back", () => {
    expect(iconFor("jobs")).toBe(icons.jobs);
    expect(iconFor("nope")).toBeDefined();
  });
  it("sms href uses & for Apple and ? otherwise; override wins", () => {
    const body = "Hi & bye?";
    expect(smsHref("+15551234567", body, "iPhone")).toBe(
      `sms:+15551234567&body=${encodeURIComponent(body)}`,
    );
    expect(smsHref("+15551234567", body, "Android")).toBe(
      `sms:+15551234567?body=${encodeURIComponent(body)}`,
    );
    expect(smsHref("+1 (555) 123-4567", "x", "Android", "?&")).toBe(
      "sms:+15551234567?&body=x",
    );
    expect(smsHref("+15551234567", "", "iPhone")).toBe("sms:+15551234567");
    expect(waHref("+1 555", "a b")).toBe("https://wa.me/1555?text=a%20b");
  });
});

/** Build a minimal JPEG with an EXIF APP1 block (big-endian TIFF). */
function jpegWithExif(): ArrayBuffer {
  const bytes: number[] = [];
  const u16 = (n: number) => bytes.push((n >> 8) & 255, n & 255);
  const ascii = (s: string) => {
    for (const c of s) bytes.push(c.charCodeAt(0));
  };
  // TIFF body (offsets relative to TIFF start)
  const tiff: number[] = [];
  const t16 = (n: number) => tiff.push((n >> 8) & 255, n & 255);
  const t32 = (n: number) =>
    tiff.push((n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
  const entry = (tag: number, type: number, count: number, value: number) => {
    t16(tag);
    t16(type);
    t32(count);
    t32(value);
  };
  // Layout: header(8) | IFD0 @8 (3 entries) | ExifIFD | GPS IFD | data
  const ifd0 = 8;
  const ifd0Size = 2 + 3 * 12 + 4;
  const exifIfd = ifd0 + ifd0Size;
  const exifSize = 2 + 1 * 12 + 4;
  const gpsIfd = exifIfd + exifSize;
  const gpsSize = 2 + 4 * 12 + 4;
  const dtAt = gpsIfd + gpsSize; // 20 bytes
  const latAt = dtAt + 20; // 3 rationals = 24
  const lngAt = latAt + 24;
  tiff.push(0x4d, 0x4d);
  t16(42);
  t32(ifd0);
  t16(3);
  entry(0x0112, 3, 1, 6 << 16); // orientation 6 (SHORT, left-justified BE)
  entry(0x8769, 4, 1, exifIfd);
  entry(0x8825, 4, 1, gpsIfd);
  t32(0);
  t16(1);
  entry(0x9003, 2, 20, dtAt);
  t32(0);
  t16(4);
  entry(1, 2, 2, 0x4e000000); // "N"
  entry(2, 5, 3, latAt);
  entry(3, 2, 2, 0x57000000); // "W"
  entry(4, 5, 3, lngAt);
  t32(0);
  for (const c of "2026:10:14 15:32:01\0") tiff.push(c.charCodeAt(0));
  for (const [n, d] of [
    [40, 1],
    [42, 1],
    [3000, 100],
  ]) {
    t32(n as number);
    t32(d as number);
  }
  for (const [n, d] of [
    [74, 1],
    [0, 1],
    [2160, 100],
  ]) {
    t32(n as number);
    t32(d as number);
  }
  u16(0xffd8);
  u16(0xffe1);
  u16(2 + 6 + tiff.length);
  ascii("Exif");
  u16(0);
  bytes.push(...tiff);
  u16(0xffd9);
  return new Uint8Array(bytes).buffer;
}

describe("exif", () => {
  it("reads capture time, orientation and GPS", () => {
    const info = parseExif(jpegWithExif());
    expect(info).not.toBeNull();
    expect(info?.takenAt).toBe("2026-10-14T15:32:01");
    expect(info?.orientation).toBe(6);
    expect(info?.lat).toBeCloseTo(40 + 42 / 60 + 30 / 3600, 6);
    expect(info?.lng).toBeCloseTo(-(74 + 0 / 60 + 21.6 / 3600), 6);
  });
  it("returns null for non-JPEG or truncated input", () => {
    expect(parseExif(new Uint8Array([1, 2, 3, 4]).buffer)).toBeNull();
    expect(parseExif(jpegWithExif().slice(0, 30))).toBeNull();
  });
});

describe("chart axis domain (QA T4-18)", () => {
  it("never shows $0.01 ticks for an all-zero money series", async () => {
    const { niceMax, formatValue } = await import("@/ui/components/charts");
    const max = niceMax(0, "money");
    expect([max, max / 2, 0].map((t) => formatValue(t, "money"))).toEqual([
      "$1",
      "$0.50",
      "$0",
    ]);
    expect(niceMax(3, "money")).toBe(100);
    expect(niceMax(123_456, "money")).toBe(200_000);
    expect(niceMax(0, "number")).toBe(2);
    expect(niceMax(7, "number")).toBe(10);
    expect(niceMax(0.3, "percent")).toBe(0.5);
  });
});
