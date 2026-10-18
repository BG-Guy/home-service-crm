import { Truck } from "lucide-react";
import { ListRow } from "@/ui/components/List";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import type { VehicleListItem } from "../contracts";

const fmt = new Intl.NumberFormat("en-US");

/** One fleet row: photo, name, assignee, odometer and due/issue chips. */
export function VehicleRowView({ v }: { v: VehicleListItem }) {
  const chips = [
    v.overdue > 0 && (
      <Pill key="o" tone="red" size="sm">
        {v.overdue} overdue
      </Pill>
    ),
    v.dueSoon > 0 && (
      <Pill key="d" tone="orange" size="sm">
        {v.dueSoon} due soon
      </Pill>
    ),
    v.openIssues > 0 && (
      <Pill key="i" tone="orange" size="sm">
        {v.openIssues} issue{v.openIssues === 1 ? "" : "s"}
      </Pill>
    ),
    v.pendingLogs > 0 && (
      <Pill key="p" tone="blue" size="sm">
        {v.pendingLogs} to review
      </Pill>
    ),
    v.status !== "active" && (
      <StatusPill key="s" kind="vehicle" status={v.status} size="sm" />
    ),
  ].filter(Boolean);
  return (
    <ListRow
      href={`/vehicles/${v.id}`}
      multiline
      leading={
        v.photoUrl ? (
          // biome-ignore lint/performance/noImgElement: signed storage thumbnail
          <img
            src={v.photoUrl}
            alt=""
            width={44}
            height={44}
            className="size-11 rounded-[10px] object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span
            aria-hidden
            className="flex size-11 items-center justify-center rounded-[10px] bg-fill-2 text-label-2"
          >
            <Truck size={22} />
          </span>
        )
      }
      title={v.nickname}
      subtitle={
        <span className="flex flex-col gap-1">
          <span>
            {[v.description, v.assignee?.name ?? "Unassigned"]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {chips.length > 0 && (
            <span className="flex flex-wrap gap-1">{chips}</span>
          )}
        </span>
      }
      detail={
        v.odometer != null ? (
          <span className="num">{fmt.format(v.odometer)} mi</span>
        ) : undefined
      }
    />
  );
}
