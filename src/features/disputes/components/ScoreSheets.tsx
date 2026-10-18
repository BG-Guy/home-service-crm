"use client";

import { ShieldCheck } from "lucide-react";
import { Button } from "@/ui/components/Button";
import {
  ReadinessRing,
  RiskChip,
  ScoreBreakdown,
  type ScoreItem,
} from "@/ui/components/Score";
import { Sheet, useSheetState } from "@/ui/components/Sheet";

export interface RiskSignalView {
  key: string;
  label: string;
  points: number;
  detail: string;
}

/** S21 body: band chip that opens the "why" sheet (signals + required controls). */
export function RiskWhyButton({
  band,
  score,
  signals,
  controls,
  computedAt,
  showWhy,
}: {
  band: "low" | "medium" | "high" | "critical";
  score: number;
  signals: RiskSignalView[];
  controls: string[];
  computedAt: string | null;
  showWhy: boolean;
}) {
  const sheet = useSheetState();
  const chip = <RiskChip band={band} score={score} />;
  if (!showWhy) return chip;
  const items: ScoreItem[] = signals.map((s) => ({
    label: s.label,
    hint: s.detail,
    points: s.points,
    state: s.points >= 0 ? "missing" : "met",
  }));
  return (
    <>
      <button
        type="button"
        onClick={sheet.show}
        className="pressable hit-44 rounded-pill outline-offset-2"
        aria-label={`Risk ${band}, score ${score}. Show why`}
        aria-haspopup="dialog"
      >
        {chip}
      </button>
      <Sheet
        {...sheet.props}
        title="Why this risk score"
        detents={["medium", "large"]}
        trailing={
          <Button size="sm" variant="plain" onClick={sheet.hide}>
            Done
          </Button>
        }
      >
        <div className="flex flex-col gap-5 p-4">
          <div className="flex items-center gap-3">
            <RiskChip band={band} score={score} />
            <p className="text-subhead text-label-2">
              Score {score} of 100
              {computedAt ? ` · updated ${computedAt}` : ""}
            </p>
          </div>
          {items.length ? (
            <section className="flex flex-col gap-1.5">
              <h3 className="px-4 text-footnote uppercase text-label-2">
                Signals
              </h3>
              <ScoreBreakdown items={items} />
            </section>
          ) : (
            <p className="text-subhead text-label-2">
              No risk signals: standard flow.
            </p>
          )}
          {controls.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <h3 className="px-4 text-footnote uppercase text-label-2">
                Required for this job
              </h3>
              <ul className="list-card">
                {controls.map((c) => (
                  <li
                    key={c}
                    className="list-row flex min-h-11 items-center gap-3 px-4 py-2.5 text-body"
                  >
                    <ShieldCheck
                      aria-hidden
                      size={18}
                      className="shrink-0 text-accent-text"
                    />
                    {c}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </Sheet>
    </>
  );
}

export interface ReadinessItemView {
  key: string;
  label: string;
  weight: number;
  applicable: boolean;
  earned: boolean;
  hint: string;
}

/** S22 body: readiness ring that opens the missing-items sheet. */
export function ReadinessWhyButton({
  score,
  items,
  size,
  showWhy,
}: {
  score: number;
  items: ReadinessItemView[];
  size: number;
  showWhy: boolean;
}) {
  const sheet = useSheetState();
  const ring = <ReadinessRing score={score} size={size} />;
  if (!showWhy) return ring;
  const missing = items.filter((i) => i.applicable && !i.earned);
  const rows: ScoreItem[] = items.map((i) => ({
    label: i.label,
    hint: !i.applicable ? "Not needed on this job (full credit)" : i.hint,
    points: i.applicable ? (i.earned ? i.weight : 0) : i.weight,
    weight: i.weight,
    state: !i.applicable ? "na" : i.earned ? "met" : "missing",
  }));
  return (
    <>
      <button
        type="button"
        onClick={sheet.show}
        className="pressable rounded-full outline-offset-2"
        aria-label={`Dispute readiness ${score} of 100${missing.length ? `, ${missing.length} missing` : ""}. Show details`}
        aria-haspopup="dialog"
      >
        {ring}
      </button>
      <Sheet
        {...sheet.props}
        title="Dispute readiness"
        detents={["medium", "large"]}
        trailing={
          <Button size="sm" variant="plain" onClick={sheet.hide}>
            Done
          </Button>
        }
      >
        <div className="flex flex-col gap-5 p-4">
          <div className="flex items-center gap-4">
            <ReadinessRing score={score} size={56} />
            <p className="text-subhead text-label-2">
              {missing.length === 0
                ? "This job is fully documented. If the customer disputes the charge, the evidence pack is ready."
                : `${missing.length} item${missing.length === 1 ? "" : "s"} missing. Each one you add makes a chargeback easier to win.`}
            </p>
          </div>
          <ScoreBreakdown items={rows} />
        </div>
      </Sheet>
    </>
  );
}
