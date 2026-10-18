// ★ Golden: GSM-7 detection and SMS segment counts (SPEC M12 template lint).
import { describe, expect, it } from "vitest";
import {
  gsmLint,
  smsSegments,
  toGsmSafe,
  withStopFooter,
} from "@/features/messaging/lint";

describe("smsSegments", () => {
  it.each([
    ["", "GSM-7", 0, 0],
    ["a".repeat(160), "GSM-7", 160, 1],
    ["a".repeat(161), "GSM-7", 161, 2],
    ["a".repeat(306), "GSM-7", 306, 2],
    ["a".repeat(307), "GSM-7", 307, 3],
    ["€".repeat(80), "GSM-7", 160, 1], // extension chars count 2 septets
    ["{}[]~^|\\", "GSM-7", 16, 1],
    ["é".repeat(70), "GSM-7", 70, 1], // é is in the GSM basic set
    ["😀", "UCS-2", 2, 1], // surrogate pair = 2 UTF-16 units
    [`${"a".repeat(70)}’`, "UCS-2", 71, 2],
    ["ç".repeat(70), "UCS-2", 70, 1], // lowercase ç is not GSM basic
    [`${"x".repeat(134)}😀`, "UCS-2", 136, 3],
  ])("%j → %s, %i units, %i segments", (text, enc, units, segs) => {
    const s = smsSegments(text);
    expect(s.encoding).toBe(enc);
    expect(s.units).toBe(units);
    expect(s.segments).toBe(segs);
  });

  it("reports the characters that force UCS-2", () => {
    expect(smsSegments("Hi “Pat” 😀 ok").nonGsmChars).toEqual(["“", "”", "😀"]);
  });
});

describe("gsmLint + fixes", () => {
  it("curly quotes and dashes are fixable; emoji are not", () => {
    const l = gsmLint("It’s “ready” — 😀");
    expect(l.encoding).toBe("UCS-2");
    expect(l.fixable.sort()).toEqual(["—", "’", "“", "”"].sort());
    expect(l.warnings[0]).toMatch(/UCS-2/);
    expect(toGsmSafe("It’s “ready” — ok…")).toBe('It\'s "ready" - ok...');
    expect(smsSegments(toGsmSafe("It’s “ready” — ok…")).encoding).toBe("GSM-7");
  });

  it("warns on long texts", () => {
    expect(
      gsmLint("a".repeat(500)).warnings.some((w) => /segments/.test(w)),
    ).toBe(true);
  });
});

describe("STOP footer", () => {
  it("appends once with sensible punctuation", () => {
    expect(withStopFooter("See you at 2")).toBe(
      "See you at 2. Reply STOP to opt out.",
    );
    expect(withStopFooter("See you at 2!")).toBe(
      "See you at 2! Reply STOP to opt out.",
    );
    expect(withStopFooter("Reply STOP to opt out.")).toBe(
      "Reply STOP to opt out.",
    );
  });
});
