import { describe, expect, it } from "vitest";
import { contrast } from "@/lib/branding";
import { docStage, STAGE_FILL, stageStyle } from "@/lib/stage-colors";

describe("money-stage colors", () => {
  it("keeps white labels at AA on every stage fill", () => {
    for (const fill of Object.values(STAGE_FILL))
      expect(contrast(fill, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("points every accent token at the stage", () => {
    const s = stageStyle("estimate") as Record<string, string>;
    expect(s["--accent"]).toBe(STAGE_FILL.estimate);
    expect(s["--accent-fill"]).toBe(STAGE_FILL.estimate);
    expect(s["--accent-text"]).toBe("var(--ink-indigo)");
    expect(s["--ink-accent"]).toBe("var(--ink-indigo)");
    expect(s["--on-accent"]).toBe("#fff");
    expect(
      (stageStyle("paid") as Record<string, string>)["--accent-text"],
    ).toBe("var(--ink-green)");
  });

  it("colors documents by where the money is", () => {
    expect(docStage("estimate", "approved")).toBe("estimate");
    expect(docStage("invoice", "draft")).toBe("invoice");
    expect(docStage("invoice", "partially_paid")).toBe("invoice");
    expect(docStage("invoice", "paid")).toBe("paid");
  });
});
