"use client";

import {
  ClipboardCheck,
  Ellipsis,
  FileText,
  Fuel,
  Gauge,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { cx } from "@/ui/cx";
import { type Tone, toneStyle } from "@/ui/tone";
import type { ApprovalHint } from "../rules";
import type { SheetVehicle } from "./sheets/OdometerSheet";

// Quick-action tiles on the vehicle screen. Each sheet is its own lazy chunk, so the
// detail page ships only these buttons until a form is opened.

const OdometerSheet = dynamic(
  () => import("./sheets/OdometerSheet").then((m) => m.OdometerSheet),
  { ssr: false },
);
const FuelSheet = dynamic(
  () => import("./sheets/FuelSheet").then((m) => m.FuelSheet),
  { ssr: false },
);
const ServiceSheet = dynamic(
  () => import("./sheets/ServiceSheet").then((m) => m.ServiceSheet),
  { ssr: false },
);
const DocumentSheet = dynamic(
  () => import("./sheets/DocumentSheet").then((m) => m.DocumentSheet),
  { ssr: false },
);
const InspectionSheet = dynamic(
  () => import("./sheets/InspectionSheet").then((m) => m.InspectionSheet),
  { ssr: false },
);
const IssueSheet = dynamic(
  () => import("./sheets/IssueSheet").then((m) => m.IssueSheet),
  { ssr: false },
);

const ActionSheet = dynamic(
  () => import("@/ui/components/ActionSheet").then((m) => m.ActionSheet),
  { ssr: false },
);

/** Warm a sheet's chunk on intent (hover / press) so the tap opens it at once. */
const PRELOAD: Record<LogKind, () => Promise<unknown>> = {
  odometer: () => import("./sheets/OdometerSheet"),
  fuel: () => import("./sheets/FuelSheet"),
  service: () => import("./sheets/ServiceSheet"),
  document: () => import("./sheets/DocumentSheet"),
  inspection: () => import("./sheets/InspectionSheet"),
  issue: () => import("./sheets/IssueSheet"),
};

export type LogKind =
  | "odometer"
  | "fuel"
  | "service"
  | "document"
  | "inspection"
  | "issue";

const LABEL: Record<LogKind, string> = {
  odometer: "Odometer",
  fuel: "Fuel",
  service: "Service",
  document: "Document",
  inspection: "Inspect",
  issue: "Issue",
};

function Tile({
  icon,
  label,
  tone,
  onClick,
  onIntent,
}: {
  icon: ReactNode;
  label: string;
  tone: Tone;
  onClick: () => void;
  onIntent?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={onIntent}
      onPointerDown={onIntent}
      onFocus={onIntent}
      className="pressable hover-lift flex min-h-[76px] flex-col items-center justify-center gap-2 rounded-card bg-card px-1 py-3 text-footnote font-semibold tracking-tight text-label shadow-card"
    >
      <span
        aria-hidden
        className="tint-bg tint-fg flex size-10 items-center justify-center rounded-full"
        style={toneStyle(tone)}
      >
        {icon}
      </span>
      {label}
    </button>
  );
}

export function VehicleActions({
  vehicle,
  allowed,
  today,
  odometerHint,
}: {
  vehicle: SheetVehicle;
  /** Log kinds this viewer may submit (policy step 1 + perms). */
  allowed: LogKind[];
  today: string;
  /** What saving an odometer reading does for this viewer (sheet copy). */
  odometerHint?: ApprovalHint;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpenRaw] = useState<LogKind | null>(null);
  // Sheets stay mounted after first open so their exit animation can play.
  const [mounted, setMounted] = useState<LogKind[]>([]);
  const setOpen = (k: LogKind | null) => {
    if (k) setMounted((m) => (m.includes(k) ? m : [...m, k]));
    setOpenRaw(k);
  };
  const [more, setMore] = useState(false);
  const [moreUsed, setMoreUsed] = useState(false);
  const can = (k: LogKind) => allowed.includes(k);

  // Deep link: /vehicles/[id]?log=odometer|fuel|service|inspection|issue opens the form.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once per param value
  useEffect(() => {
    const log = params.get("log") as LogKind | null;
    if (log && can(log)) {
      setOpen(log);
      const next = new URLSearchParams(params.toString());
      next.delete("log");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [params.get("log")]);

  const primary: { kind: LogKind; icon: ReactNode; tone: Tone }[] = [
    {
      kind: "odometer" as const,
      icon: <Gauge size={19} />,
      tone: "blue" as const,
    },
    {
      kind: "fuel" as const,
      icon: <Fuel size={19} />,
      tone: "green" as const,
    },
    {
      kind: "inspection" as const,
      icon: <ClipboardCheck size={19} />,
      tone: "indigo" as const,
    },
    {
      kind: "issue" as const,
      icon: <TriangleAlert size={19} />,
      tone: "orange" as const,
    },
  ].filter((t) => can(t.kind));
  const secondary = (["service", "document"] as const).filter(can);
  const blocked = (
    ["odometer", "fuel", "service", "document", "inspection"] as const
  ).filter((k) => !can(k));
  const toggle = (k: LogKind) => (o: boolean) => setOpen(o ? k : null);

  return (
    <div className="flex flex-col gap-2">
      {(primary.length > 0 || secondary.length > 0) && (
        <div
          className={cx(
            "grid gap-2",
            primary.length + (secondary.length ? 1 : 0) >= 5
              ? "grid-cols-5"
              : "grid-cols-4",
          )}
        >
          {primary.map((t) => (
            <Tile
              key={t.kind}
              icon={t.icon}
              label={LABEL[t.kind]}
              tone={t.tone}
              onClick={() => setOpen(t.kind)}
              onIntent={() => void PRELOAD[t.kind]()}
            />
          ))}
          {secondary.length > 0 && (
            <Tile
              icon={<Ellipsis size={19} />}
              label="More"
              tone="gray"
              onClick={() => {
                setMoreUsed(true);
                setMore(true);
              }}
            />
          )}
        </div>
      )}
      {blocked.length > 0 && (
        <p className="px-1 text-footnote text-label-2">
          Ask your admin to log{" "}
          {blocked.map((b) => LABEL[b].toLowerCase()).join(", ")} entries.
        </p>
      )}
      {moreUsed && (
        <ActionSheet
          open={more}
          onOpenChange={setMore}
          title={vehicle.nickname}
          items={[
            ...(can("service")
              ? [
                  {
                    label: "Log service",
                    icon: <Wrench size={20} aria-hidden />,
                    onSelect: () => setOpen("service"),
                  },
                ]
              : []),
            ...(can("document")
              ? [
                  {
                    label: "Add document",
                    icon: <FileText size={20} aria-hidden />,
                    onSelect: () => setOpen("document"),
                  },
                ]
              : []),
          ]}
        />
      )}
      {mounted.includes("odometer") && (
        <OdometerSheet
          open={open === "odometer"}
          onOpenChange={toggle("odometer")}
          vehicle={vehicle}
          approvalHint={odometerHint}
        />
      )}
      {mounted.includes("fuel") && (
        <FuelSheet
          open={open === "fuel"}
          onOpenChange={toggle("fuel")}
          vehicle={vehicle}
        />
      )}
      {mounted.includes("service") && (
        <ServiceSheet
          open={open === "service"}
          onOpenChange={toggle("service")}
          vehicle={vehicle}
          today={today}
        />
      )}
      {mounted.includes("document") && (
        <DocumentSheet
          open={open === "document"}
          onOpenChange={toggle("document")}
          vehicle={vehicle}
        />
      )}
      {mounted.includes("inspection") && (
        <InspectionSheet
          open={open === "inspection"}
          onOpenChange={toggle("inspection")}
          vehicle={vehicle}
        />
      )}
      {mounted.includes("issue") && (
        <IssueSheet
          open={open === "issue"}
          onOpenChange={toggle("issue")}
          vehicle={vehicle}
        />
      )}
    </div>
  );
}
