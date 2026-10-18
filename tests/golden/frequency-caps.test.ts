// ★ Golden: frequency caps (SPEC M12): ≤ 3 automated non-live per 24 h; marketing ≤ 1 / 7 d.
import { describe, expect, it } from "vitest";
import {
  type CapInput,
  checkFrequencyCaps,
} from "@/features/messaging/compliance";
import { zonedParts } from "@/lib/time";

const CHI = "America/Chicago";
const now = new Date("2026-10-15T17:00:00Z"); // 12:00 CDT
const h = (n: number) => new Date(now.getTime() - n * 3600_000);
const base: CapInput = {
  now,
  purpose: "transactional",
  automated: true,
  templateKey: "job.reminder_24h",
  live: false,
  recentAutomated: [],
  recentMarketing: [],
  caps: { automated_per_24h: 3, marketing_per_7d: 1 },
  timeZone: CHI,
  random: () => 0,
};

describe("checkFrequencyCaps", () => {
  it("allows up to the cap", () => {
    expect(
      checkFrequencyCaps({ ...base, recentAutomated: [h(1), h(5)] }),
    ).toEqual({ ok: true });
  });

  it("the 4th automated text in 24 h waits for tomorrow's window", () => {
    const d = checkFrequencyCaps({
      ...base,
      recentAutomated: [h(1), h(5), h(23)],
    });
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toBe("cap_24h");
    const p = zonedParts(d.deferTo, CHI);
    expect([p.day, p.hour]).toEqual([16, 8]);
  });

  it("sends older than 24 h don't count", () => {
    expect(
      checkFrequencyCaps({ ...base, recentAutomated: [h(1), h(5), h(25)] }).ok,
    ).toBe(true);
  });

  it("review requests count toward the automated cap", () => {
    expect(
      checkFrequencyCaps({
        ...base,
        purpose: "review",
        templateKey: "review.request",
        recentAutomated: [h(1), h(2), h(3)],
      }).ok,
    ).toBe(false);
  });

  it("live / direct-response texts and manual sends are never capped", () => {
    const busy = [h(1), h(2), h(3), h(4)];
    expect(
      checkFrequencyCaps({ ...base, live: true, recentAutomated: busy }).ok,
    ).toBe(true);
    expect(
      checkFrequencyCaps({
        ...base,
        templateKey: "job.on_my_way",
        recentAutomated: busy,
      }).ok,
    ).toBe(true);
    expect(
      checkFrequencyCaps({
        ...base,
        templateKey: "payment.receipt",
        recentAutomated: busy,
      }).ok,
    ).toBe(true);
    expect(
      checkFrequencyCaps({ ...base, automated: false, recentAutomated: busy })
        .ok,
    ).toBe(true);
    expect(
      checkFrequencyCaps({
        ...base,
        purpose: "internal",
        recentAutomated: busy,
      }).ok,
    ).toBe(true);
  });

  it("marketing: 1 per 7 days, deferred until the window frees up", () => {
    const sent = new Date(now.getTime() - 2 * 86_400_000);
    const d = checkFrequencyCaps({
      ...base,
      purpose: "marketing",
      templateKey: "marketing.maintenance",
      recentMarketing: [sent],
    });
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toBe("cap_marketing_7d");
    expect(d.deferTo.getTime()).toBeGreaterThanOrEqual(
      sent.getTime() + 7 * 86_400_000,
    );
    const p = zonedParts(d.deferTo, CHI);
    expect(p.hour).toBeGreaterThanOrEqual(8);
    expect(p.hour).toBeLessThan(20);
  });

  it("marketing older than 7 days doesn't count", () => {
    expect(
      checkFrequencyCaps({
        ...base,
        purpose: "marketing",
        templateKey: "marketing.maintenance",
        recentMarketing: [new Date(now.getTime() - 8 * 86_400_000)],
      }).ok,
    ).toBe(true);
  });
});
