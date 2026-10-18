import { ListRow, ListSection } from "@/ui/components/List";
import type { ExportItem } from "../queries";

/** Nightly backup status (server component). */
export function BackupsPanel({
  items,
  enabled,
  keepDaily,
  keepWeekly,
}: {
  items: ExportItem[];
  enabled: boolean;
  keepDaily: number;
  keepWeekly: number;
}) {
  const live = items.filter((i) => i.status === "ready");
  const last = live[0];
  const stale =
    !last || Date.now() - Date.parse(last.createdAt) > 36 * 3600_000;
  return (
    <ListSection
      header="Nightly backups"
      footer={`Every night at 2:00 a JSON copy of all data goes to storage under backups/<date>/. We keep ${keepDaily} daily and ${keepWeekly} weekly copies. Restore with: npm run restore -- backups/<date>`}
    >
      <ListRow
        title="Status"
        detail={
          !enabled
            ? "Off"
            : stale
              ? last
                ? "Behind"
                : "No backup yet"
              : "Up to date"
        }
        subtitle={
          enabled && stale
            ? "Backups run from the scheduler. Make sure the cron job calls /api/cron/tick."
            : undefined
        }
      />
      {live.slice(0, 5).map((b) => (
        <ListRow
          key={b.id}
          title={b.date ?? b.createdAt.slice(0, 10)}
          detail={
            b.rows != null ? `${b.rows.toLocaleString()} rows` : undefined
          }
        />
      ))}
    </ListSection>
  );
}
