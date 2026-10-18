"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { UrlSegmented } from "@/features/settings/components/UrlSegmented";
import { Button } from "@/ui/components/Button";
import { DateField } from "@/ui/components/Field";
import { cx } from "@/ui/cx";
import { PERIOD_LABELS, PERIODS, type PeriodKey } from "../period";

/**
 * Period selector (SPEC M20): Today / Week / Month / 30 days / Custom. Custom shows
 * two date inputs and applies on "Show". Keeps other params (e.g. `view`).
 */
export function PeriodBar({
  period,
  fromKey,
  toKey,
  todayKey,
}: {
  period: PeriodKey;
  fromKey: string;
  toKey: string;
  todayKey: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [custom, setCustom] = useState(period === "custom");
  const [from, setFrom] = useState(fromKey);
  const [to, setTo] = useState(toKey);
  const [pending, start] = useTransition();

  function apply() {
    const next = new URLSearchParams(params.toString());
    next.set("period", "custom");
    next.set("from", from <= to ? from : to);
    next.set("to", from <= to ? to : from);
    start(() => router.replace(`${pathname}?${next}`, { scroll: false }));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <UrlSegmented
          className="min-w-0 flex-1"
          param="period"
          value={custom ? "custom" : period}
          defaultValue="week"
          clear={["from", "to"]}
          onChange={() => setCustom(false)}
          label="Period"
          segments={PERIODS.filter((p) => p !== "custom").map((p) => ({
            value: p,
            label: PERIOD_LABELS[p],
          }))}
        />
        <Button
          variant={custom ? "tinted" : "gray"}
          size="sm"
          aria-pressed={custom}
          onClick={() => setCustom((c) => !c)}
        >
          Custom
        </Button>
      </div>
      {custom && (
        <div
          className={cx(
            "enter-fade-up flex flex-wrap items-end gap-2 rounded-card bg-card p-3",
            pending && "opacity-70",
          )}
        >
          <DateField
            label="From"
            value={from}
            max={todayKey}
            presets={false}
            onChange={(e) => setFrom(e.currentTarget.value)}
            className="min-w-[9rem] flex-1"
          />
          <DateField
            label="To"
            value={to}
            min={from || undefined}
            max={todayKey}
            presets={false}
            onChange={(e) => setTo(e.currentTarget.value)}
            className="min-w-[9rem] flex-1"
          />
          <Button
            size="md"
            onClick={apply}
            loading={pending}
            disabled={!from || !to}
          >
            Show
          </Button>
        </div>
      )}
    </div>
  );
}
