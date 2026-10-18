import { CircleCheck, TriangleAlert } from "lucide-react";
import { ListRow, ListSection } from "@/ui/components/List";
import type { Anomaly } from "../kpis";

/**
 * Weekly anomaly report (SPEC M20). Hits first (critical, then warnings) with a
 * count badge and a link to the list behind them; clear signals collapse into one
 * "all clear" footer line so the card stays short.
 */
export function AnomalyCard({ items }: { items: Anomaly[] }) {
  const hits = items
    .filter((i) => i.count > 0)
    .sort(
      (a, b) =>
        (a.severity === "critical" ? -1 : 0) -
        (b.severity === "critical" ? -1 : 0),
    );
  const clear = items.filter((i) => i.count === 0);
  return (
    <ListSection
      footer={
        clear.length
          ? `All clear: ${clear.map((c) => c.label.toLowerCase()).join(" · ")}.`
          : undefined
      }
    >
      {hits.length === 0 ? (
        <ListRow
          icon={<CircleCheck size={17} aria-hidden />}
          iconTone="green"
          title="Nothing unusual"
          subtitle="No leakage or fraud signals in this window"
        />
      ) : (
        hits.map((a) => (
          <ListRow
            key={a.key}
            icon={<TriangleAlert size={17} aria-hidden />}
            iconTone={a.severity === "critical" ? "red" : "orange"}
            title={a.label}
            subtitle={a.detail}
            multiline
            accessory="badge"
            badge={a.count}
            badgeCritical={a.severity === "critical"}
            href={a.href ?? undefined}
          />
        ))
      )}
    </ListSection>
  );
}
