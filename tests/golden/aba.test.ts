// ★ ABA routing checksum (client and server validation on /pay/bank).
import { describe, expect, it } from "vitest";
import {
  isValidAba,
  isValidAccountNumber,
} from "@/features/payroll/engine/aba";

describe("ABA checksum", () => {
  it.each([
    "011000015",
    "021000021",
    "121000358",
    "011401533",
    "091000019",
  ])("accepts %s", (r) => {
    expect(isValidAba(r)).toBe(true);
  });
  it.each([
    "011000016",
    "123456789",
    "12345678",
    "0110000155",
    "abcdefghi",
    "991000015",
  ])("rejects %s", (r) => {
    expect(isValidAba(r)).toBe(false);
  });
  it("account numbers are 4–17 digits", () => {
    expect(isValidAccountNumber("1234")).toBe(true);
    expect(isValidAccountNumber("12345678901234567")).toBe(true);
    expect(isValidAccountNumber("123")).toBe(false);
    expect(isValidAccountNumber("12-34")).toBe(false);
  });
});
