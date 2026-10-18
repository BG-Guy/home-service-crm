import type { Metadata } from "next";
import { NotificationsList } from "@/features/notify/components/NotificationsList";
import { listNotifications } from "@/features/notify/queries";
import { PushEnableButton } from "@/features/notify/slots.client";
import { requireUser } from "@/lib/auth/current";
import { getCompany } from "@/lib/settings";
import { safeTimeZone } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Notifications" };

// Notification center (SPEC M22): grouped by day, deep links, mark all read.
export default async function NotificationsPage() {
  await requireUser();
  const [initial, company] = await Promise.all([
    listNotifications({ limit: 50 }),
    getCompany(),
  ]);
  return (
    <PageTransition>
      <LargeTitleHeader title="Notifications" />
      <Page>
        <div className="mb-[var(--section-gap)] px-1">
          <PushEnableButton label="Get these on your phone" />
        </div>
        <NotificationsList
          initial={initial}
          timeZone={safeTimeZone(company.timezone)}
        />
      </Page>
    </PageTransition>
  );
}
