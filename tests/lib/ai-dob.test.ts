// Assign hub privacy: team members' dates of birth never go to AI.
import { describe, expect, it } from "vitest";
import { findPii } from "@/adapters/ai/policy";

describe("AI PII guard: date of birth", () => {
  it("flags date-of-birth text", () => {
    expect(findPii("Tech DOB 1990-01-01")).toContain("date of birth");
    expect(findPii("date of birth: Jan 2 1990")).toContain("date of birth");
    expect(findPii("birthdate 1990-01-01")).toContain("date of birth");
  });
  it("leaves ordinary text alone", () => {
    expect(findPii("Replace the garage door spring")).toEqual([]);
  });
});
