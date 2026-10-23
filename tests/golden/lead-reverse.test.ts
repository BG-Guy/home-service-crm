// Golden rules for the leads-flow redesign item 4 ("every action has its way back")
// and the "one count everywhere" fix: what each reverse sets, Reopen goes back to
// the status the lead had before, a booked lead reopens only once its job is
// cancelled, Undo restores what a change overwrote, and the one lead count.
import { describe, expect, it } from "vitest";
import type { LeadBoxData } from "@/features/leads/contracts";
import {
  actionGroups,
  countsAsNew,
  isFlagged,
  previousOpenStatus,
  releaseRule,
  reopenRule,
  STATUS_STEPS,
  shortName,
  stepTarget,
  toMapPoint,
  undoPatch,
} from "@/features/leads/rules";

describe("status steps and their reverse", () => {
  it("each step sets exactly one status, from the statuses it applies to", () => {
    expect(STATUS_STEPS.contacted).toMatchObject({
      from: ["new"],
      to: "contacted",
    });
    expect(STATUS_STEPS.not_contacted).toMatchObject({
      from: ["contacted"],
      to: "new",
    });
    expect(STATUS_STEPS.qualify).toMatchObject({
      from: ["new", "contacted"],
      to: "qualified",
    });
    expect(STATUS_STEPS.unqualify).toMatchObject({
      from: ["qualified"],
      to: "contacted",
    });
  });

  it.each([
    ["contacted", "new", "contacted"],
    ["contacted", "contacted", null],
    ["not_contacted", "contacted", "new"],
    ["not_contacted", "qualified", null],
    ["qualify", "new", "qualified"],
    ["qualify", "contacted", "qualified"],
    ["qualify", "lost", null],
    ["unqualify", "qualified", "contacted"],
    ["unqualify", "booked", null],
  ] as const)("%s from %s → %s", (step, from, to) => {
    expect(stepTarget(step, from)).toBe(to);
  });
});

describe("Reopen goes back to the status the lead had before", () => {
  it.each([
    // [history newest first, current, answered, expected]
    [
      [
        { from: "contacted", to: "lost" },
        { from: "new", to: "contacted" },
      ],
      "lost",
      true,
      "contacted",
    ],
    [[{ from: "new", to: "lost" }], "lost", false, "new"],
    [
      [
        { from: "qualified", to: "lost" },
        { from: "contacted", to: "qualified" },
      ],
      "lost",
      true,
      "qualified",
    ],
    // Lost, then marked spam: back along the chain to the last open status.
    [
      [
        { from: "lost", to: "spam" },
        { from: "contacted", to: "lost" },
      ],
      "spam",
      true,
      "contacted",
    ],
    // Booked from Qualified, job cancelled: back to Qualified.
    [
      [
        { from: "qualified", to: "booked" },
        { from: "new", to: "qualified" },
      ],
      "booked",
      false,
      "qualified",
    ],
    // An Undo in between counts as a hop like any other.
    [
      [
        { from: "new", to: "lost" },
        { from: "qualified", to: "new" },
        { from: "new", to: "qualified" },
      ],
      "lost",
      false,
      "new",
    ],
    // "Looks legit" rows (from === to) are not hops.
    [
      [
        { from: "contacted", to: "lost" },
        { from: "contacted", to: "contacted" },
      ],
      "lost",
      true,
      "contacted",
    ],
  ] as const)("history %j, now %s → %s", (history, current, answered, want) => {
    expect(previousOpenStatus(history, current, answered)).toBe(want);
  });

  it("without usable history: Contacted when someone answered, else New", () => {
    expect(previousOpenStatus([], "spam", false)).toBe("new");
    expect(previousOpenStatus([], "lost", true)).toBe("contacted");
    // A loop never hangs.
    expect(
      previousOpenStatus(
        [
          { from: "spam", to: "lost" },
          { from: "lost", to: "spam" },
        ],
        "lost",
        false,
      ),
    ).toBe("new");
  });
});

describe("which closed leads can reopen", () => {
  it("lost and spam always", () => {
    expect(reopenRule({ status: "lost", jobStatus: null })).toEqual({
      ok: true,
    });
    expect(reopenRule({ status: "spam", jobStatus: null })).toEqual({
      ok: true,
    });
  });
  it("a booked lead only once its job is cancelled", () => {
    expect(reopenRule({ status: "booked", jobStatus: "cancelled" })).toEqual({
      ok: true,
    });
    for (const s of [
      "scheduled",
      "confirmed",
      "in_progress",
      "completed",
      "closed",
    ])
      expect(reopenRule({ status: "booked", jobStatus: s })).toMatchObject({
        ok: false,
      });
    expect(reopenRule({ status: "booked", jobStatus: null })).toMatchObject({
      ok: false,
    });
  });
  it("open leads have nothing to reopen", () => {
    for (const s of ["new", "contacted", "qualified"])
      expect(reopenRule({ status: s, jobStatus: null })).toBeNull();
  });
});

describe("Claim ↔ Release", () => {
  it("release is for your own lead; someone else's is a take over", () => {
    expect(releaseRule("me", "me")).toBe("ok");
    expect(releaseRule("you", "me")).toBe("someone_else");
    expect(releaseRule(null, "me")).toBe("unassigned");
  });
});

describe("Undo restores what a change overwrote", () => {
  const prev = {
    lost_reason: "price",
    spam_score: 62,
    spam_reason: "ts_missing",
    converted_job_id: "job-1",
  };
  it("a status step", () => {
    expect(
      undoPatch(
        { from: "new", to: "qualified", prev },
        { status: "qualified" },
      ),
    ).toEqual({
      status: "new",
      lostReason: null,
      spamScore: 62,
      spamReason: "ts_missing",
      convertedJobId: "job-1",
    });
  });
  it("Reopen puts the lost reason back", () => {
    expect(
      undoPatch(
        { from: "lost", to: "contacted", prev },
        { status: "contacted" },
      )?.lostReason,
    ).toBe("price");
  });
  it("Mark spam puts the score back (a Check lead stays in Check)", () => {
    expect(
      undoPatch({ from: "new", to: "spam", prev }, { status: "spam" }),
    ).toMatchObject({ status: "new", spamScore: 62 });
  });
  it("Reopening a booked lead: Undo restores the booking and its job", () => {
    expect(
      undoPatch(
        {
          from: "booked",
          to: "qualified",
          prev: { ...prev, converted_job_id: "job-9" },
        },
        { status: "qualified" },
      ),
    ).toMatchObject({ status: "booked", convertedJobId: "job-9" });
  });
  it("nothing to undo once the lead moved on", () => {
    expect(
      undoPatch({ from: "new", to: "qualified", prev }, { status: "lost" }),
    ).toBeNull();
    expect(undoPatch(null, { status: "new" })).toBeNull();
  });
});

describe("one count everywhere", () => {
  const T = 50;
  it.each([
    [{ status: "new", spamScore: 0 }, true],
    [{ status: "new", spamScore: 49 }, true],
    // "Check" leads wait for a person in their own chip, not the badge.
    [{ status: "new", spamScore: 50 }, false],
    [{ status: "contacted", spamScore: 0 }, false],
    [{ status: "qualified", spamScore: 0 }, false],
    [{ status: "booked", spamScore: 0 }, false],
    [{ status: "lost", spamScore: 0 }, false],
    [{ status: "spam", spamScore: 100 }, false],
  ] as const)("%j counts as new: %s", (l, want) => {
    expect(countsAsNew(l, T)).toBe(want);
  });
  it("Check = an open lead at or over the review line", () => {
    expect(isFlagged({ status: "contacted", spamScore: 50 }, T)).toBe(true);
    expect(isFlagged({ status: "spam", spamScore: 100 }, T)).toBe(false);
    expect(isFlagged({ status: "new", spamScore: 10 }, T)).toBe(false);
  });
});

describe("action groups (no … menu)", () => {
  const base = {
    phone: "(512) 555-0128",
    email: "a@b.co",
    customerId: "c1",
    assignedUserId: null as string | null,
    job: null as LeadBoxData["job"],
    check: false,
  };
  const can = { edit: true, convert: true };
  const keys = (l: Parameters<typeof actionGroups>[0], c = can) =>
    Object.fromEntries(actionGroups(l, c, "me").map((g) => [g.key, g.actions]));

  it("a new lead: reach, move forward, manage, close", () => {
    expect(keys({ ...base, status: "new" })).toEqual({
      reach: ["call", "text", "email"],
      forward: ["contacted", "qualify", "book"],
      manage: ["claim", "edit", "tags"],
      close: ["lost", "spam"],
    });
  });
  it("each step flips to its way back", () => {
    expect(keys({ ...base, status: "contacted" }).forward).toEqual([
      "not_contacted",
      "qualify",
      "book",
    ]);
    expect(
      keys({ ...base, status: "qualified", assignedUserId: "me" }),
    ).toMatchObject({
      forward: ["unqualify", "book"],
      manage: ["release", "edit", "tags"],
    });
    expect(
      keys({ ...base, status: "new", assignedUserId: "you" }).manage,
    ).toEqual(["take_over", "edit", "tags"]);
    expect(keys({ ...base, status: "lost" })).toMatchObject({
      close: ["reopen", "spam"],
    });
    expect(keys({ ...base, status: "lost" }).forward).toBeUndefined();
    expect(keys({ ...base, status: "spam" }).close).toEqual(["not_spam"]);
  });
  it("Check leads: Looks legit, and booking stays allowed", () => {
    expect(keys({ ...base, status: "new", check: true }).forward).toEqual([
      "legit",
      "book",
    ]);
  });
  it("booked: Open job, and Reopen in Close", () => {
    const job = {
      id: "j",
      number: "J-1",
      status: "scheduled",
      cancelled: false,
    };
    expect(keys({ ...base, status: "booked", job })).toMatchObject({
      forward: ["open_job"],
      close: ["reopen"],
    });
  });
  it("view-only people see no actions; Book needs convert", () => {
    expect(
      actionGroups(
        { ...base, status: "new" },
        { edit: false, convert: false },
        "me",
      ),
    ).toEqual([]);
    expect(
      keys({ ...base, status: "new" }, { edit: true, convert: false }).forward,
    ).toEqual(["contacted", "qualify"]);
  });
  it("no phone: no Call; Text only through the customer", () => {
    expect(
      keys({ ...base, status: "new", phone: null, email: null }).reach,
    ).toEqual(["text"]);
    expect(
      keys({
        ...base,
        status: "new",
        phone: null,
        email: null,
        customerId: null,
      }).reach,
    ).toBeUndefined();
  });
});

describe("display helpers", () => {
  it("short names", () => {
    expect(shortName("Jacob Wilson")).toBe("Jacob W.");
    expect(shortName("María José Ortega")).toBe("María O.");
    expect(shortName("Cher")).toBe("Cher");
    expect(shortName("(512) 555-0128")).toBe("(512) 555-0128");
  });
  it("map points need coordinates", () => {
    const box = {
      id: "l1",
      initials: "JW",
      status: "new",
      slaStart: "2026-10-22T10:00:00.000Z",
      respondedAt: null,
      shortName: "Jacob W.",
      lat: 30.27,
      lng: -97.74,
    } as LeadBoxData;
    expect(toMapPoint(box)).toMatchObject({
      id: "l1",
      lat: 30.27,
      lng: -97.74,
    });
    expect(toMapPoint({ ...box, lat: null })).toBeNull();
  });
});
