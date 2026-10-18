import { Wrench } from "lucide-react";
import { ListRow } from "@/ui/components/List";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import type { ToolListItem } from "../queries";

const DUE_TONE = {
  overdue: "red",
  due: "orange",
  due_soon: "orange",
  ok: "gray",
} as const;

/** One tool row: photo, name, tag/serial, holder and due chips. */
export function ToolRowView({
  t,
  showHolder,
}: {
  t: ToolListItem;
  showHolder: boolean;
}) {
  const chips = [
    t.status !== "assigned" && t.status !== "available" && (
      <StatusPill key="s" kind="tool" status={t.status} size="sm" />
    ),
    t.calibration !== "ok" && (
      <Pill key="c" tone={DUE_TONE[t.calibration]} size="sm">
        Calibration {t.calibration === "overdue" ? "overdue" : "due"}
      </Pill>
    ),
    t.maintenance !== "ok" && (
      <Pill key="m" tone={DUE_TONE[t.maintenance]} size="sm">
        Maintenance {t.maintenance === "overdue" ? "overdue" : "due"}
      </Pill>
    ),
    t.unacknowledged && (
      <Pill key="a" tone="blue" size="sm">
        Not acknowledged
      </Pill>
    ),
    t.owner === "tech_owned" && (
      <Pill key="o" tone="indigo" size="sm">
        Tech-owned
      </Pill>
    ),
  ].filter(Boolean);
  return (
    <ListRow
      href={`/tools/${t.id}`}
      multiline
      leading={
        t.photoUrl ? (
          // biome-ignore lint/performance/noImgElement: signed storage thumbnail
          <img
            src={t.photoUrl}
            alt=""
            width={44}
            height={44}
            loading="lazy"
            decoding="async"
            className="size-11 rounded-[10px] object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="flex size-11 items-center justify-center rounded-[10px] bg-fill-2 text-label-2"
          >
            <Wrench size={20} />
          </span>
        )
      }
      title={t.name}
      subtitle={
        <span className="flex flex-col gap-1">
          <span>
            {[
              t.assetTag,
              [t.brand, t.model].filter(Boolean).join(" ") || null,
              showHolder
                ? (t.holderName ??
                  t.vehicleName ??
                  (t.status === "available" ? "In stock" : null))
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {chips.length > 0 && (
            <span className="flex flex-wrap gap-1">{chips}</span>
          )}
        </span>
      }
    />
  );
}
