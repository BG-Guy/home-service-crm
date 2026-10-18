// Module manifest: `vehicles` (SPEC §15.1). Owner: B7.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "vehicles",
  name: "Vehicles",
  description:
    "Fleet, odometer/fuel/service logs, reminders, documents, inspections, issues and trips.",
  owner: "B7",
  grants,
  flags,
  settingsShape,
  settingsPage: "/settings/vehicles",
  nav,
  emits: [
    "vehicle.log_submitted",
    "vehicle.reminder_due",
    "vehicle.document_expiring",
    "vehicle.issue_reported",
    "vehicle.anomaly",
  ],
  customFieldEntities: ["vehicle"],
});
