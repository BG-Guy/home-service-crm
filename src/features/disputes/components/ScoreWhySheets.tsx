"use client";

import { ShieldCheck } from "lucide-react";
import { Button } from "@/ui/components/Button";
import {
  ReadinessRing,
  RiskChip,
  ScoreBreakdown,
  type ScoreItem,
} from "@/ui/components/Score";
import { Sheet } from "@/ui/components/Sheet";

// The "why" sheets of ScoreSheets.tsx: a lazy chunk loaded on the first tap.

interface Ctl {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function RiskWhySheet({
  open,
  onOpenChange,
  band,
  score,
  items,
  controls,
  computedAt,
}: Ctl & {
  band: "low" | "medium" | "high" | "critical";
  score: number;
  items: ScoreItem[];
  controls: string[];
  computedAt: string | null;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Why this risk score"
      detents={["medium", "large"]}
      trailing={
        <Button size="sm" variant="plain" onClick={() => onOpenChange(false)}>
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
            <h3 className="px-4 text-subhead font-semibold text-label-2">
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
            <h3 className="px-4 text-subhead font-semibold text-label-2">
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
  );
}

export function ReadinessWhySheet({
  open,
  onOpenChange,
  score,
  missingCount,
  rows,
}: Ctl & { score: number; missingCount: number; rows: ScoreItem[] }) {
  const missing = { length: missingCount };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Dispute readiness"
      detents={["medium", "large"]}
      trailing={
        <Button size="sm" variant="plain" onClick={() => onOpenChange(false)}>
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
  );
}
