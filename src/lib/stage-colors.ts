// Money-stage colors ("color by stage", Quote to Paid): estimates violet, invoices blue,
// paid green. Applied as inline custom properties on a container, so every accent-driven
// control inside it (primary and tinted buttons, selected chips, links) follows the stage
// without new global CSS. Fills keep white labels at ≥ 4.5:1 (tests/golden/stage-colors);
// text uses the AA --ink-* tokens, which already switch with the theme.
import type { CSSProperties } from "react";

export type StageColor = "estimate" | "invoice" | "paid";

export const STAGE_FILL: Record<StageColor, string> = {
  estimate: "#6155f5",
  invoice: "#0074d9",
  paid: "#23863c",
};

const STAGE_INK: Record<StageColor, string> = {
  estimate: "var(--ink-indigo)",
  invoice: "var(--ink-blue)",
  paid: "var(--ink-green)",
};

/** Inline style that points the accent tokens at a money stage's color. */
export function stageStyle(stage: StageColor): CSSProperties {
  return {
    "--accent": STAGE_FILL[stage],
    "--accent-fill": STAGE_FILL[stage],
    "--accent-text": STAGE_INK[stage],
    "--on-accent": "#fff",
    "--ink-accent": STAGE_INK[stage],
  } as CSSProperties;
}

/** The stage color a document follows: estimates violet, invoices blue until paid. */
export function docStage(
  kind: "estimate" | "invoice",
  status: string | null | undefined,
): StageColor {
  if (kind === "estimate") return "estimate";
  return status === "paid" ? "paid" : "invoice";
}
