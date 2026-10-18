// NACHA (ACH) credit file builder (SPEC M16 "NACHA file export"). Pure, no I/O.
// 94-character records, blocking factor 10, PPD (personal) and CCD (business)
// credit batches with service class 220. Golden-tested (tests/golden/nacha*.test.ts).
import { isValidAba } from "./aba";

export interface NachaCompany {
  /** Immediate destination: the bank's routing number (9 digits). */
  immediateDestination: string;
  immediateDestinationName: string;
  /** Immediate origin (10 chars; usually "1" + EIN, or the company's id at the bank). */
  immediateOrigin: string;
  immediateOriginName: string;
  /** Batch company name (16) and company identification (10). */
  companyName: string;
  companyId: string;
  /** ODFI routing (first 8 digits are used). */
  odfiRouting: string;
  entryDescription?: string; // default "PAYROLL"
}

export interface NachaEntry {
  /** Stable reference, e.g. the settlement id (not written to the file). */
  ref: string;
  name: string;
  /** Individual identification (15): e.g. the tech's short id. */
  idNumber: string;
  routing: string;
  account: string;
  accountType: "checking" | "savings";
  holderType: "personal" | "business";
  amountCents: number;
}

export interface NachaFile {
  content: string;
  lines: string[];
  entryCount: number;
  totalCreditCents: number;
  entryHash: number;
  batchCount: number;
  blockCount: number;
  secCodes: ("PPD" | "CCD")[];
}

const clean = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .toUpperCase();
const alpha = (s: string, len: number) =>
  clean(s).slice(0, len).padEnd(len, " ");
const num = (n: number | string, len: number) => {
  const s = String(n).replace(/\D/g, "");
  if (s.length > len) return s.slice(s.length - len);
  return s.padStart(len, "0");
};
const yymmdd = (d: string) => d.replace(/-/g, "").slice(2, 8);

export class NachaError extends Error {}

/**
 * Build a balanced-by-totals credit file. Entries with amount ≤ 0 are rejected.
 * `effectiveDate` / `createdAt` are company-local ('YYYY-MM-DD', 'HHMM').
 */
export function buildNachaFile(i: {
  company: NachaCompany;
  entries: readonly NachaEntry[];
  effectiveDate: string;
  fileDate: string;
  fileTime: string;
  fileIdModifier?: string;
}): NachaFile {
  const c = i.company;
  if (!isValidAba(c.immediateDestination))
    throw new NachaError(
      "Bank routing number (immediate destination) is invalid.",
    );
  if (!/^\d{8,9}$/.test(c.odfiRouting))
    throw new NachaError("ODFI routing number is invalid.");
  if (!c.companyId.trim())
    throw new NachaError("Company identification is required.");
  for (const e of i.entries) {
    if (e.amountCents <= 0 || !Number.isSafeInteger(e.amountCents))
      throw new NachaError(`Invalid amount for ${e.name}.`);
    if (!isValidAba(e.routing))
      throw new NachaError(`Routing number for ${e.name} is invalid.`);
    if (!/^\d{1,17}$/.test(e.account))
      throw new NachaError(`Account number for ${e.name} is invalid.`);
  }
  const odfi8 = c.odfiRouting.slice(0, 8);
  const lines: string[] = [];
  lines.push(
    [
      "1",
      "01",
      ` ${c.immediateDestination}`,
      alpha(c.immediateOrigin.padStart(10, " "), 10),
      yymmdd(i.fileDate),
      num(i.fileTime, 4),
      alpha(i.fileIdModifier ?? "A", 1),
      "094",
      "10",
      "1",
      alpha(c.immediateDestinationName, 23),
      alpha(c.immediateOriginName, 23),
      alpha("", 8),
    ].join(""),
  );

  const groups: { sec: "PPD" | "CCD"; entries: NachaEntry[] }[] = [];
  const ppd = i.entries.filter((e) => e.holderType === "personal");
  const ccd = i.entries.filter((e) => e.holderType === "business");
  if (ppd.length) groups.push({ sec: "PPD", entries: ppd });
  if (ccd.length) groups.push({ sec: "CCD", entries: ccd });

  let fileEntries = 0;
  let fileHash = 0;
  let fileCredit = 0;
  let trace = 0;
  groups.forEach((g, gi) => {
    const batchNo = num(gi + 1, 7);
    lines.push(
      [
        "5",
        "220",
        alpha(c.companyName, 16),
        alpha("", 20),
        alpha(c.companyId, 10),
        g.sec,
        alpha(c.entryDescription ?? "PAYROLL", 10),
        alpha(yymmdd(i.effectiveDate), 6),
        yymmdd(i.effectiveDate),
        "   ",
        "1",
        odfi8,
        batchNo,
      ].join(""),
    );
    let hash = 0;
    let credit = 0;
    for (const e of g.entries) {
      trace++;
      const rdfi = e.routing.slice(0, 8);
      hash += Number(rdfi);
      credit += e.amountCents;
      lines.push(
        [
          "6",
          e.accountType === "savings" ? "32" : "22",
          rdfi,
          e.routing.slice(8, 9),
          alpha(e.account, 17),
          num(e.amountCents, 10),
          alpha(e.idNumber, 15),
          alpha(e.name, 22),
          "  ",
          "0",
          odfi8,
          num(trace, 7),
        ].join(""),
      );
    }
    lines.push(
      [
        "8",
        "220",
        num(g.entries.length, 6),
        num(hash % 10_000_000_000, 10),
        num(0, 12),
        num(credit, 12),
        alpha(c.companyId, 10),
        alpha("", 19),
        alpha("", 6),
        odfi8,
        batchNo,
      ].join(""),
    );
    fileEntries += g.entries.length;
    fileHash += hash;
    fileCredit += credit;
  });

  const recordCount = lines.length + 1;
  const blockCount = Math.ceil(recordCount / 10);
  lines.push(
    [
      "9",
      num(groups.length, 6),
      num(blockCount, 6),
      num(fileEntries, 8),
      num(fileHash % 10_000_000_000, 10),
      num(0, 12),
      num(fileCredit, 12),
      alpha("", 39),
    ].join(""),
  );
  while (lines.length % 10 !== 0) lines.push("9".repeat(94));
  for (const l of lines)
    if (l.length !== 94)
      throw new NachaError(`Record length ${l.length} ≠ 94: ${l.slice(0, 1)}`);
  return {
    content: `${lines.join("\n")}\n`,
    lines,
    entryCount: fileEntries,
    totalCreditCents: fileCredit,
    entryHash: fileHash % 10_000_000_000,
    batchCount: groups.length,
    blockCount,
    secCodes: groups.map((g) => g.sec),
  };
}
