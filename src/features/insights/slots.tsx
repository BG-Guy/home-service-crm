import "server-only";
import { getCurrentUser } from "@/lib/auth/current";
import { ReopenSetupButton, SetupChecklistCard } from "./components/islands";
import { OpsBoard } from "./components/OpsBoard";
import type { OpsTodayProps } from "./contracts";
import { getSetupChecklist } from "./setup";

// Server UI slots produced by B8 (BUILD_PLAN §5.1). Each takes ids (none here), calls
// getCurrentUser() itself and returns null when the viewer may not see it.

/**
 * S54 — Office dashboard ("Today / Ops", SPEC M20) plus the M01 setup checklist card
 * for admins. Mounted by B2's /today for office and admin users.
 */
export async function OpsToday(_props: OpsTodayProps) {
  const user = await getCurrentUser();
  if (!user || !user.perms.has("insights.view_ops")) return null;
  const setup = user.perms.has("settings.manage")
    ? await getSetupChecklist(user.id)
    : null;
  const showSetup = setup && setup.done < setup.total;
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {showSetup && !setup.dismissed && (
        <SetupChecklistCard checklist={setup} canEdit compact />
      )}
      <OpsBoard user={user} />
      {showSetup && setup.dismissed && (
        <div className="flex justify-center">
          <ReopenSetupButton />
        </div>
      )}
    </div>
  );
}
