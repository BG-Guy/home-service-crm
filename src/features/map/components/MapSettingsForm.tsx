"use client";

import { useState, useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { ListGroup, ListSection } from "@/ui/components/List";
import { Stepper } from "@/ui/components/Stepper";
import { toast } from "@/ui/components/Toast";
import { saveMapSettings } from "../actions";

export interface MapSettingsValues {
  keep_breadcrumbs_days: number;
  ping_interval_sec: number;
  stale_minutes: number;
  hide_after_minutes: number;
}

function Row({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="list-row flex min-h-11 items-center justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <p className="text-body">{title}</p>
        {subtitle && <p className="text-footnote text-label-2">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/** /settings/map: ping interval, staleness thresholds and breadcrumb retention. */
export function MapSettingsForm({ initial }: { initial: MapSettingsValues }) {
  const [s, setS] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const set = (p: Partial<MapSettingsValues>) => {
    setDirty(true);
    setS((x) => ({ ...x, ...p }));
  };
  return (
    <div className="flex flex-col gap-6">
      <ListGroup>
        <ListSection
          header="Location pings"
          footer="Phones send a position at most this often while a tech is clocked in and the app is open. Status changes (On my way, Arrived…) also stamp a position."
        >
          <Row
            title="Ping every"
            subtitle={`${Math.round(s.ping_interval_sec / 60)} min`}
          >
            <Stepper
              label="Ping interval in minutes"
              value={Math.round(s.ping_interval_sec / 60)}
              min={1}
              max={15}
              onChange={(v) => set({ ping_interval_sec: v * 60 })}
              format={(n) => `${n} min`}
            />
          </Row>
        </ListSection>
        <ListSection header="Live map">
          <Row
            title="Grey after"
            subtitle="A marker fades when it hasn’t updated."
          >
            <Stepper
              label="Minutes before a marker turns grey"
              value={s.stale_minutes}
              min={5}
              max={120}
              step={5}
              onChange={(v) => set({ stale_minutes: v })}
              format={(n) => `${n} min`}
            />
          </Row>
          <Row title="Hide after" subtitle="Hidden unless “Show stale” is on.">
            <Stepper
              label="Minutes before a marker is hidden"
              value={s.hide_after_minutes}
              min={15}
              max={480}
              step={15}
              onChange={(v) => set({ hide_after_minutes: v })}
              format={(n) => `${n} min`}
            />
          </Row>
        </ListSection>
        <ListSection
          header="Breadcrumbs ⚖️"
          footer="Off by default. When on, every ping is also kept as a breadcrumb for this many days, then deleted nightly. Only positions sent while clocked in are ever stored."
        >
          <Row
            title="Keep breadcrumbs"
            subtitle={
              s.keep_breadcrumbs_days
                ? `${s.keep_breadcrumbs_days} days`
                : "Off"
            }
          >
            <Stepper
              label="Days to keep breadcrumbs"
              value={s.keep_breadcrumbs_days}
              min={0}
              max={30}
              onChange={(v) => set({ keep_breadcrumbs_days: v })}
              format={(n) => (n ? `${n} d` : "Off")}
            />
          </Row>
        </ListSection>
      </ListGroup>
      <Button
        size="lg"
        fullWidth
        loading={pending}
        disabled={!dirty}
        onClick={() =>
          start(async () => {
            const r = await saveMapSettings(s);
            if (!r.ok) toast({ title: r.error, tone: "error" });
            else {
              setDirty(false);
              toast({ title: "Map settings saved", tone: "success" });
            }
          })
        }
      >
        Save changes
      </Button>
    </div>
  );
}
