import { describe, expect, it } from "vitest";
import { US_STATES } from "@/app/(auth)/signup/options";
import { usStateCode } from "@/lib/us-states";

describe("usStateCode", () => {
  it("maps every state and DC by name, any case", () => {
    for (const [code, name] of US_STATES) {
      expect(usStateCode(name)).toBe(code);
      expect(usStateCode(name.toUpperCase())).toBe(code);
    }
  });

  it("accepts codes and ISO 3166-2 forms", () => {
    expect(usStateCode("TX")).toBe("TX");
    expect(usStateCode(" tx ")).toBe("TX");
    expect(usStateCode("US-TX")).toBe("TX");
    expect(usStateCode("us-dc")).toBe("DC");
  });

  it("knows territories and common spellings", () => {
    expect(usStateCode("Puerto Rico")).toBe("PR");
    expect(usStateCode("U.S. Virgin Islands")).toBe("VI");
    expect(usStateCode("United States Virgin Islands")).toBe("VI");
    expect(usStateCode("Guam")).toBe("GU");
    expect(usStateCode("Washington, D.C.")).toBe("DC");
    expect(usStateCode("District of Columbia")).toBe("DC");
    expect(usStateCode("Washington")).toBe("WA");
  });

  it("unknown or empty is an empty string", () => {
    expect(usStateCode("Ontario")).toBe("");
    expect(usStateCode("XX")).toBe("");
    expect(usStateCode("")).toBe("");
    expect(usStateCode(null)).toBe("");
    expect(usStateCode(undefined)).toBe("");
  });
});
