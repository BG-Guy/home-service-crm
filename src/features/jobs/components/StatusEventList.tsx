import { MapPin } from "lucide-react";
import { formatDateTime } from "@/lib/time";
import { statusDef } from "@/ui/status";
import { toneStyle } from "@/ui/tone";
import { formatDistance } from "../machine";
import type { StatusEventView } from "../types";
import { ROW_SEP } from "./sep";

/** B2's geostamped status-event list for the job History tab. */
export function StatusEventList({
  events,
  tz,
}: {
  events: StatusEventView[];
  tz: string;
}) {
  if (events.length === 0)
    return (
      <p className="px-4 py-3 text-subhead text-label-2">
        No status changes yet.
      </p>
    );
  return (
    <ol className="flex flex-col">
      {events.map((e) => {
        const def = statusDef("job", e.to);
        const maps =
          e.lat != null && e.lng != null
            ? `https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lng}`
            : null;
        return (
          <li key={e.id} className={`${ROW_SEP} flex gap-3 px-4 py-3`}>
            <span
              aria-hidden
              className="mt-1.5 size-2.5 shrink-0 rounded-full bg-[var(--tone)]"
              style={toneStyle(def.tone)}
            />
            <div className="min-w-0 flex-1">
              <p className="text-body">
                {e.from ? `${statusDef("job", e.from).label} → ` : ""}
                <span className="font-semibold">{def.label}</span>
                {e.etaMinutes ? (
                  <span className="text-label-2">
                    {" "}
                    · ETA {e.etaMinutes} min
                  </span>
                ) : null}
              </p>
              <p className="text-footnote text-label-2">
                {formatDateTime(e.at, tz)}
                {e.actorName ? ` · ${e.actorName}` : " · System"}
              </p>
              {e.note && (
                <p className="mt-0.5 text-footnote text-label-2">{e.note}</p>
              )}
              {maps ? (
                <a
                  href={maps}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-footnote text-accent"
                >
                  <MapPin size={12} aria-hidden />
                  {e.lat?.toFixed(5)}, {e.lng?.toFixed(5)}
                  {e.accuracyM != null && ` ±${Math.round(e.accuracyM)} m`}
                  {e.distanceM != null &&
                    ` · ${formatDistance(e.distanceM)} from property`}
                </a>
              ) : (
                e.to !== "scheduled" &&
                e.to !== "unscheduled" &&
                e.to !== "confirmed" && (
                  <p className="mt-0.5 text-caption text-label-3">
                    No geostamp
                  </p>
                )
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
