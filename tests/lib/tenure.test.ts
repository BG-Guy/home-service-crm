import { describe, expect, it } from "vitest";
import { memberProfileDateErrors } from "@/features/team/rules";
import {
  ageOn,
  experienceLabel,
  monthsBetween,
  tenureLabel,
} from "@/lib/tenure";

describe("tenure helpers", () => {
  it("counts whole months, day of month included", () => {
    expect(monthsBetween("2024-06-15", "2026-10-14")).toBe(27);
    expect(monthsBetween("2024-06-15", "2026-10-15")).toBe(28);
    expect(monthsBetween("2026-10-21", "2026-01-01")).toBe(0);
  });
  it("formats time at the company", () => {
    expect(tenureLabel("2024-06-15", "2026-10-21")).toBe("2 y 4 mo");
    expect(tenureLabel("2025-03-01", "2026-10-21")).toBe("1 y 7 mo");
    expect(tenureLabel("2026-03-01", "2026-10-21")).toBe("7 mo");
    expect(tenureLabel("2022-10-01", "2026-10-21")).toBe("4 y");
    expect(tenureLabel("2026-10-10", "2026-10-21")).toBe("New");
    expect(tenureLabel("2026-11-01", "2026-10-21")).toBe("Starts soon");
    expect(tenureLabel(null, "2026-10-21")).toBeNull();
  });
  it("computes age on a calendar day (birthday counts)", () => {
    expect(ageOn("1990-10-21", "2026-10-21")).toBe(36);
    expect(ageOn("1990-10-22", "2026-10-21")).toBe(35);
    expect(ageOn("2030-01-01", "2026-10-21")).toBeNull();
    expect(ageOn("", "2026-10-21")).toBeNull();
  });
  it("labels experience", () => {
    expect(experienceLabel(0)).toBe("Under a year");
    expect(experienceLabel(1)).toBe("1 year");
    expect(experienceLabel(12)).toBe("12 years");
    expect(experienceLabel(null)).toBeNull();
  });
});

describe("memberProfileDateErrors (Edit profile validation)", () => {
  const today = "2026-10-21";
  it("accepts valid values and empty fields", () => {
    expect(
      memberProfileDateErrors(
        {
          hireDate: "2020-06-15",
          experienceYears: 12,
          birthDate: "1990-01-01",
        },
        today,
      ),
    ).toEqual({});
    expect(memberProfileDateErrors({}, today)).toEqual({});
  });
  it("rejects a future hire date", () => {
    expect(
      memberProfileDateErrors({ hireDate: "2026-10-22" }, today).hireDate,
    ).toBeDefined();
  });
  it("keeps experience within 0–60 whole years", () => {
    expect(
      memberProfileDateErrors({ experienceYears: 61 }, today),
    ).toHaveProperty("experienceYears");
    expect(
      memberProfileDateErrors({ experienceYears: -1 }, today),
    ).toHaveProperty("experienceYears");
    expect(memberProfileDateErrors({ experienceYears: 0 }, today)).toEqual({});
    expect(memberProfileDateErrors({ experienceYears: 60 }, today)).toEqual({});
  });
  it("needs a birth date in the past and an age of 16–100", () => {
    const bd = (birthDate: string) =>
      memberProfileDateErrors({ birthDate }, today).birthDate;
    expect(bd("2026-10-21")).toEqual([
      "The date of birth must be in the past.",
    ]);
    expect(bd("2010-10-22")).toEqual(["Team members must be at least 16."]);
    expect(bd("2010-10-21")).toBeUndefined(); // 16 today
    expect(bd("1926-10-21")).toBeUndefined(); // 100 today
    expect(bd("1925-10-21")).toEqual([
      "Check the year: that's over 100 years ago.",
    ]);
  });
});
