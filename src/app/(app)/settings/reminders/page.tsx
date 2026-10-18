import type { Metadata } from "next";
import { RemindersManager } from "@/features/automations/components/RemindersManager";
import { listReminders } from "@/features/automations/queries";
import { PushedScreen } from "@/features/messaging/components/PushedScreen";
import { requireUser } from "@/lib/auth/current";
import { getCompany } from "@/lib/settings";
import { safeTimeZone } from "@/lib/time";

export const metadata: Metadata = { title: "Reminders" };

// Settings → Reminders (SPEC M13): once, daily, weekly, monthly, every N days/months
// or every N miles (vehicle odometer); to a person, a role or a customer.
export default async function SettingsRemindersPage() {
  await requireUser("reminders.manage");
  const [data, company] = await Promise.all([listReminders(), getCompany()]);
  return (
    <PushedScreen
      title="Reminders"
      intro="Recurring nudges for your team or customers that aren't tied to a job event."
    >
      <RemindersManager
        items={data.items}
        users={data.users}
        roles={data.roles}
        vehicles={data.vehicles}
        timeZone={safeTimeZone(company.timezone)}
      />
    </PushedScreen>
  );
}
