// ★ NACHA file golden test: 94-char records, blocking factor 10, entry hash and totals,
// PPD vs CCD batches, and (in the DAL) bank-change exclusion — see tests/payroll/*.
import { describe, expect, it } from "vitest";
import { buildNachaFile, NachaError } from "@/features/payroll/engine/nacha";

const company = {
  immediateDestination: "011000015",
  immediateDestinationName: "Federal Reserve Bank",
  immediateOrigin: "1123456789",
  immediateOriginName: "Acme Home Services",
  companyName: "Acme Home Svcs",
  companyId: "1123456789",
  odfiRouting: "011000015",
};

const entries = [
  {
    ref: "s1",
    name: "Tom Rivera",
    idNumber: "TECH1",
    routing: "011000015",
    account: "123456789",
    accountType: "checking" as const,
    holderType: "personal" as const,
    amountCents: 125075,
  },
  {
    ref: "s2",
    name: "Maria Lopez",
    idNumber: "TECH2",
    routing: "021000021",
    account: "987654321",
    accountType: "savings" as const,
    holderType: "personal" as const,
    amountCents: 98000,
  },
  {
    ref: "s3",
    name: "Patel Lock LLC",
    idNumber: "TECH3",
    routing: "121000358",
    account: "5550001",
    accountType: "checking" as const,
    holderType: "business" as const,
    amountCents: 45025,
  },
];

describe("NACHA builder", () => {
  const f = buildNachaFile({
    company,
    entries,
    effectiveDate: "2026-10-16",
    fileDate: "2026-10-15",
    fileTime: "0930",
  });

  it("every record is 94 chars and the file is blocked by 10", () => {
    for (const l of f.lines) expect(l).toHaveLength(94);
    expect(f.lines.length % 10).toBe(0);
    expect(f.blockCount).toBe(f.lines.length / 10);
  });

  it("has a header, PPD and CCD batches, entries and a control record", () => {
    const types = f.lines.map((l) => l[0]).join("");
    expect(types.startsWith("156685689")).toBe(true);
    expect(f.batchCount).toBe(2);
    expect(f.secCodes).toEqual(["PPD", "CCD"]);
    expect(f.lines[1]?.slice(50, 53)).toBe("PPD");
    expect(f.lines[5]?.slice(50, 53)).toBe("CCD");
    expect(f.lines[1]?.slice(1, 4)).toBe("220");
  });

  it("entry details: transaction codes, RDFI, check digit, amount, trace", () => {
    const e1 = f.lines[2] as string;
    expect(e1.slice(1, 3)).toBe("22"); // checking credit
    expect(e1.slice(3, 11)).toBe("01100001");
    expect(e1.slice(11, 12)).toBe("5");
    expect(e1.slice(29, 39)).toBe("0000125075");
    expect(e1.slice(54, 76)).toBe("TOM RIVERA            ");
    expect(e1.slice(79, 94)).toBe("011000010000001");
    expect((f.lines[3] as string).slice(1, 3)).toBe("32"); // savings credit
  });

  it("hash and totals", () => {
    const hash = 1100001 + 2100002 + 12100035;
    expect(f.entryHash).toBe(hash);
    expect(f.totalCreditCents).toBe(125075 + 98000 + 45025);
    const control = f.lines.find(
      (l) => l.startsWith("9") && l !== "9".repeat(94),
    ) as string;
    expect(control.slice(1, 7)).toBe("000002");
    expect(control.slice(13, 21)).toBe("00000003");
    expect(control.slice(21, 31)).toBe(String(hash).padStart(10, "0"));
    expect(control.slice(43, 55)).toBe(String(268100).padStart(12, "0"));
    const ppdControl = f.lines[4] as string;
    expect(ppdControl[0]).toBe("8");
    expect(ppdControl.slice(4, 10)).toBe("000002");
    expect(ppdControl.slice(32, 44)).toBe(String(223075).padStart(12, "0"));
  });

  it("rejects invalid routing numbers and non-positive amounts", () => {
    expect(() =>
      buildNachaFile({
        company,
        entries: [{ ...entries[0], routing: "011000016" } as never],
        effectiveDate: "2026-10-16",
        fileDate: "2026-10-15",
        fileTime: "0930",
      }),
    ).toThrow(NachaError);
    expect(() =>
      buildNachaFile({
        company,
        entries: [{ ...entries[0], amountCents: 0 } as never],
        effectiveDate: "2026-10-16",
        fileDate: "2026-10-15",
        fileTime: "0930",
      }),
    ).toThrow(NachaError);
  });
});

describe("NACHA effective date (QA T3-16)", () => {
  it("defaults to the next business day", async () => {
    const { nextBusinessDay, isBusinessDay } = await import(
      "@/features/payroll/engine/periods"
    );
    expect(nextBusinessDay("2026-10-16")).toBe("2026-10-19"); // Fri → Mon
    expect(nextBusinessDay("2026-10-17")).toBe("2026-10-19"); // Sat → Mon
    expect(nextBusinessDay("2026-10-18")).toBe("2026-10-19"); // Sun → Mon
    expect(nextBusinessDay("2026-10-19")).toBe("2026-10-20"); // Mon → Tue
    expect(isBusinessDay("2026-10-18")).toBe(false);
    expect(isBusinessDay("2026-10-21")).toBe(true);
  });
});
