"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { ReadinessRing, RiskChip, type ScoreItem } from "@/ui/components/Score";

// The sheets load on hover/focus or the first tap (DESIGN.md §2).
const load = () => import("./ScoreWhySheets");
const RiskWhySheet = dynamic(() => load().then((m) => m.RiskWhySheet), {
  ssr: false,
});
const ReadinessWhySheet = dynamic(
  () => load().then((m) => m.ReadinessWhySheet),
  { ssr: false },
);
const prefetch = () => void load();

function useLazyOpen() {
  const [open, setOpenState] = useState(false);
  const [armed, setArmed] = useState(false);
  const setOpen = (v: boolean) => {
    if (v) setArmed(true);
    setOpenState(v);
  };
  return { open, armed, setOpen };
}

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
  const { open, armed, setOpen } = useLazyOpen();
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
        onClick={() => setOpen(true)}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        className="pressable hit-44 rounded-pill outline-offset-2"
        aria-label={`Risk ${band}, score ${score}. Show why`}
        aria-haspopup="dialog"
      >
        {chip}
      </button>
      {armed && (
        <RiskWhySheet
          open={open}
          onOpenChange={setOpen}
          band={band}
          score={score}
          items={items}
          controls={controls}
          computedAt={computedAt}
        />
      )}
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
  const { open, armed, setOpen } = useLazyOpen();
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
        onClick={() => setOpen(true)}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        className="pressable rounded-full outline-offset-2"
        aria-label={`Dispute readiness ${score} of 100${missing.length ? `, ${missing.length} missing` : ""}. Show details`}
        aria-haspopup="dialog"
      >
        {ring}
      </button>
      {armed && (
        <ReadinessWhySheet
          open={open}
          onOpenChange={setOpen}
          score={score}
          missingCount={missing.length}
          rows={rows}
        />
      )}
    </>
  );
}
