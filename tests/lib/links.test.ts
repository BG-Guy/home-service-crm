import { describe, expect, it } from "vitest";
import { mapsHref, personHref, profileHref } from "@/lib/links";

const viewer = (id: string, ...perms: string[]) => ({
  id,
  perms: new Set(perms),
});

describe("personHref", () => {
  it("opens the profile for team managers and for yourself", () => {
    expect(personHref(viewer("a", "users.manage"), "t1")).toBe("/team/t1");
    expect(personHref(viewer("t1"), "t1")).toBe("/team/t1");
  });

  it("falls back to the person's day on the schedule for dispatchers", () => {
    expect(personHref(viewer("o", "schedule.view_all"), "t1")).toBe(
      "/schedule?view=day&tech=t1",
    );
    expect(
      personHref(viewer("o", "schedule.view_all"), "t1", {
        date: "2026-10-20",
      }),
    ).toBe("/schedule?view=day&tech=t1&date=2026-10-20");
  });

  it("is null when there's nowhere to go", () => {
    expect(personHref(viewer("t2", "jobs.view_own"), "t1")).toBeNull();
    expect(personHref(viewer("a", "users.manage"), null)).toBeNull();
  });
});

describe("profileHref", () => {
  it("is the profile for team managers and for yourself only", () => {
    expect(profileHref(viewer("a", "users.manage"), "t1")).toBe("/team/t1");
    expect(profileHref(viewer("t1"), "t1")).toBe("/team/t1");
  });

  it("never falls back to the schedule", () => {
    expect(profileHref(viewer("o", "schedule.view_all"), "t1")).toBeNull();
    expect(profileHref(viewer("a", "users.manage"), undefined)).toBeNull();
  });
});

describe("mapsHref", () => {
  const p = { street: "1 Main St", city: "Austin", state: "TX", zip: "78701" };
  it("uses Apple Maps on Apple devices and Google Maps elsewhere", () => {
    expect(mapsHref(p, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)")).toBe(
      "https://maps.apple.com/?daddr=1%20Main%20St%2C%20Austin%2C%20TX%2078701",
    );
    expect(mapsHref(p, "Mozilla/5.0 (Linux; Android 14)")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=1%20Main%20St%2C%20Austin%2C%20TX%2078701",
    );
  });

  it("prefers coordinates", () => {
    expect(mapsHref({ ...p, lat: 30.1, lng: -97.7 }, "Android")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=30.1,-97.7",
    );
    expect(
      mapsHref({ full: "1 Main St", lat: 30.1, lng: -97.7 }, "Macintosh"),
    ).toBe("https://maps.apple.com/?daddr=30.1,-97.7&q=1%20Main%20St");
  });

  it("is null without an address or a point", () => {
    expect(mapsHref({}, "Android")).toBeNull();
    expect(mapsHref({ full: "  " }, null)).toBeNull();
  });
});
