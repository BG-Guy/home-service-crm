import { Bell, Search } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AppShell, Page, type ShellNav } from "@/ui/components/AppShell";
import { IconButton } from "@/ui/components/IconButton";
import { ListRow, ListSection } from "@/ui/components/List";
import { LazyPullToRefresh } from "@/ui/components/lazy";
import { NavBar } from "@/ui/components/NavBar";
import { OfflineBanner } from "@/ui/components/OfflineBanner";
import { StatusPill } from "@/ui/components/StatusPill";
import { PageTransition } from "@/ui/motion/PageTransition";
import { devUiEnabled } from "../enabled";

export const metadata: Metadata = {
  title: "Shell demo",
  robots: { index: false, follow: false },
};

// Example of what the integrator derives from module manifests + permissions.
const nav: ShellNav = {
  tabs: [
    { key: "today", href: "/dev/ui/shell", label: "Today", icon: "today" },
    { key: "schedule", href: "/schedule", label: "Schedule", icon: "schedule" },
    {
      key: "leads",
      href: "/leads",
      label: "Leads",
      icon: "leads",
      badgeKey: "leads.new",
    },
    {
      key: "customers",
      href: "/customers",
      label: "Customers",
      icon: "customers",
    },
    { key: "more", href: "/dev/ui", label: "More", icon: "more" },
  ],
  sections: [
    {
      title: "Overview",
      items: [
        { key: "today", href: "/dev/ui/shell", label: "Today", icon: "today" },
        {
          key: "insights",
          href: "/insights",
          label: "Insights",
          icon: "insights",
        },
      ],
    },
    {
      title: "Work",
      items: [
        {
          key: "schedule",
          href: "/schedule",
          label: "Schedule",
          icon: "schedule",
        },
        {
          key: "leads",
          href: "/leads",
          label: "Leads",
          icon: "leads",
          badgeKey: "leads.new",
        },
        { key: "jobs", href: "/jobs", label: "Jobs", icon: "jobs" },
        {
          key: "invoices",
          href: "/invoices",
          label: "Invoices",
          icon: "invoices",
          badgeKey: "invoices.overdue",
        },
      ],
    },
    {
      title: "Money",
      items: [
        {
          key: "payments",
          href: "/payments",
          label: "Payments",
          icon: "payments",
        },
        {
          key: "disputes",
          href: "/disputes",
          label: "Disputes",
          icon: "disputes",
          badgeKey: "disputes.open",
        },
      ],
    },
    {
      items: [
        {
          key: "gallery",
          href: "/dev/ui",
          label: "UI Gallery",
          icon: "dashboard",
        },
      ],
    },
  ],
};

export default async function ShellDemoPage() {
  await connection();
  if (!devUiEnabled()) notFound();
  return (
    <AppShell
      user={{ id: "u1", name: "Maria Ortega", roleLabel: "Office" }}
      nav={nav}
      badges={{ "leads.new": 3, "invoices.overdue": 5, "disputes.open": 1 }}
      brand="Acme Locksmith"
      banner={<OfflineBanner />}
    >
      <LazyPullToRefresh />
      <PageTransition>
        <NavBar
          title="Job #1042"
          back={{ href: "/dev/ui", label: "Gallery" }}
          trailing={
            <>
              <IconButton label="Search">
                <Search size={22} />
              </IconButton>
              <IconButton
                label="Notifications"
                badge={<span className="block size-2 rounded-full bg-danger" />}
              >
                <Bell size={22} />
              </IconButton>
            </>
          }
        />
        <Page className="flex flex-col gap-[var(--section-gap)] pt-4">
          <p className="text-subhead text-label-2">
            Reached with a push transition; the back button pops. Tab bar below
            1024 px, sidebar above. Pull down on a phone to refresh.
          </p>
          {["Today", "Tomorrow", "This week", "Later"].map((name) => (
            <ListSection key={name} header={name}>
              {[1, 2, 3, 4, 5].map((n) => (
                <ListRow
                  key={n}
                  title={`Row ${n}`}
                  subtitle="Scroll to see the bars stay put"
                  detail={
                    n === 1 ? (
                      <StatusPill kind="job" status="en_route" size="sm" />
                    ) : undefined
                  }
                  href="/dev/ui"
                  transition="back"
                />
              ))}
            </ListSection>
          ))}
        </Page>
      </PageTransition>
    </AppShell>
  );
}
