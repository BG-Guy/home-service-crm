"use client";

import type { ReactNode } from "react";
import { useOptimistic, useTransition } from "react";
import { ListSection } from "@/ui/components/List";
import { toast } from "@/ui/components/Toast";
import { Toggle } from "@/ui/components/Toggle";
import { type Tone, toneStyle } from "@/ui/tone";
import { setFeatureFlagAction } from "../actions";

export interface FeatureRow {
  key: string;
  label: string;
  description: string;
  icon: ReactNode;
  tone: Tone;
  enabled: boolean;
  legal?: string;
  requires?: string;
  requiresLabel?: string;
}

/** Settings → Features: one switch per module flag; saves instantly (audited). */
export function FeatureToggles({
  groups,
}: {
  groups: { label: string; footer?: string; rows: FeatureRow[] }[];
}) {
  const all = groups.flatMap((g) => g.rows);
  const [state, setOpt] = useOptimistic(
    Object.fromEntries(all.map((r) => [r.key, r.enabled])) as Record<
      string,
      boolean
    >,
    (s, u: { key: string; on: boolean }) => ({ ...s, [u.key]: u.on }),
  );
  const [, start] = useTransition();

  function flip(r: FeatureRow, on: boolean) {
    start(async () => {
      setOpt({ key: r.key, on });
      const res = await setFeatureFlagAction({ flag: r.key, enabled: on });
      if (res.ok)
        toast.success(`${r.label} ${on ? "on" : "off"}`, {
          message: on
            ? "It now appears in the menu for people with access."
            : "Hidden everywhere. Data is kept.",
        });
      else toast.error(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {groups.map((g) => (
        <ListSection key={g.label} header={g.label} footer={g.footer}>
          {g.rows.map((r) => {
            const on = state[r.key] ?? false;
            const blocked = r.requires ? !state[r.requires] : false;
            return (
              // biome-ignore lint/a11y/noLabelWithoutControl: the Toggle input is inside the label
              <label
                key={r.key}
                data-icon=""
                className="list-row flex min-h-11 cursor-pointer items-start gap-3 px-4 py-3"
              >
                <span
                  aria-hidden
                  className="tone-bg mt-0.5 flex size-[29px] shrink-0 items-center justify-center rounded-[7px]"
                  style={toneStyle(r.tone)}
                >
                  {r.icon}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body">{r.label}</span>
                  <span className="text-subhead text-label-2">
                    {r.description}
                  </span>
                  {r.legal && (
                    <span className="mt-1 text-footnote text-label-2">
                      ⚖️ {r.legal}
                    </span>
                  )}
                  {blocked && on && (
                    <span className="mt-1 text-footnote text-[var(--sys-orange)]">
                      Needs {r.requiresLabel ?? r.requires} on to work.
                    </span>
                  )}
                </span>
                <Toggle
                  className="mt-0.5 shrink-0"
                  checked={on}
                  onChange={(e) => flip(r, e.currentTarget.checked)}
                  label={r.label}
                />
              </label>
            );
          })}
        </ListSection>
      ))}
    </div>
  );
}
