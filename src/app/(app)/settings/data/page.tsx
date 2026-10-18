import type { Metadata } from "next";
import { demoResetAllowed } from "@/features/data/actions";
import { BackupsPanel } from "@/features/data/components/BackupsPanel";
import { DangerZone } from "@/features/data/components/DangerZone";
import { ExportPanel } from "@/features/data/components/ExportPanel";
import { ImportWizard } from "@/features/data/components/ImportWizard";
import { listExports } from "@/features/data/queries";
import { Screen } from "@/features/leads/components/Screen";
import { requireAnyPerm } from "@/lib/auth/current";
import { getCompanyTimezone, getSettings } from "@/lib/settings";
import { ListGroup } from "@/ui/components/List";

export const metadata: Metadata = { title: "Data" };

// Settings → Data (SPEC M24): export everything, CSV import wizard, backups, demo reset.
export default async function SettingsDataPage() {
  const user = await requireAnyPerm(["data.export", "data.import"]);
  const [exportsList, backups, s, resetOk, tz] = await Promise.all([
    listExports(user, "full", 8),
    listExports(user, "backup", 10),
    getSettings(),
    demoResetAllowed(),
    getCompanyTimezone(),
  ]);
  const p = user.perms;
  return (
    <Screen
      title="Data"
      intro="Your data is yours: export it any time, bring in records from a spreadsheet, and rely on nightly backups."
    >
      <ListGroup>
        {p.has("data.export") && (
          <ExportPanel
            items={exportsList}
            canExport={p.has("data.export")}
            timeZone={tz}
          />
        )}
        {p.has("data.import") && <ImportWizard />}
        <BackupsPanel
          items={backups}
          enabled={s.data.backups_enabled}
          keepDaily={s.data.backup_keep_daily}
          keepWeekly={s.data.backup_keep_weekly}
        />
        {resetOk && user.baseRole === "admin" && p.has("data.import") && (
          <DangerZone />
        )}
      </ListGroup>
    </Screen>
  );
}
