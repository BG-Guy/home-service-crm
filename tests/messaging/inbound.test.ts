// Inbound reply classification (SPEC M12): STOP/START/HELP, C/R, natural-language opt-outs.
import { describe, expect, it } from "vitest";
import { classifyInbound } from "@/features/messaging/lint";

describe("classifyInbound", () => {
  it.each([
    "STOP",
    "stop",
    " Stop. ",
    "STOPALL",
    "UNSUBSCRIBE",
    "CANCEL",
    "END",
    "QUIT",
    "REVOKE",
    "OPTOUT",
    "opt out",
  ])("%j → stop", (b) => expect(classifyInbound(b).kind).toBe("stop"));
  it.each(["START", "yes", "UNSTOP"])("%j → start", (b) =>
    expect(classifyInbound(b).kind).toBe("start"));
  it.each(["HELP", "info"])("%j → help", (b) =>
    expect(classifyInbound(b).kind).toBe("help"));
  it("C / R appointment replies", () => {
    expect(classifyInbound("C").kind).toBe("confirm");
    expect(classifyInbound("c!").kind).toBe("confirm");
    expect(classifyInbound("Confirmed").kind).toBe("confirm");
    expect(classifyInbound("R").kind).toBe("reschedule");
    expect(classifyInbound("reschedule").kind).toBe("reschedule");
  });
  it("keywords must be the whole message", () => {
    expect(classifyInbound("please don't stop by before 9").kind).not.toBe(
      "stop",
    );
    expect(classifyInbound("Can you come at 3? C").kind).toBe("other");
  });
  it("natural-language opt-outs are only flagged", () => {
    for (const b of [
      "Please stop texting me",
      "wrong number",
      "remove me from your list",
      "don't text me again",
    ]) {
      const r = classifyInbound(b);
      expect(r.kind).toBe("optout_nl");
      expect(r.confidence).toBeGreaterThanOrEqual(0.5);
      expect(r.confidence).toBeLessThan(1);
    }
    expect(classifyInbound("Who is this?").kind).toBe("other"); // too weak alone
    expect(classifyInbound("Thanks, see you then").kind).toBe("other");
  });
});
