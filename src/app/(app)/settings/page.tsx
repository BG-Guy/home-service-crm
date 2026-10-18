import { sql } from "drizzle-orm";
import { Building } from "lucide-react";
import type { Metadata } from "next";
import { execRows } from "@/db";
import { ReopenSetupButton } from "@/features/insights/components/ReopenSetupButton";
import { SetupChecklistCard } from "@/features/insights/components/SetupChecklistCard";
import { getSetupChecklist } from "@/features/insights/setup";
import { SettingsIndexList } from "@/features/settings/components/SettingsIndexList";
import { settingsGroupsFor } from "@/features/settings/nav-model";
import { requireUser } from "@/lib/auth/current";
import { findCompany, getSettings } from "@/lib/settings";
import { Page } from "@/ui/components/AppShell";
import { Button } from "@/ui/components/Button";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { StatCard } from "@/ui/components/StatCard";
import { PageTransition } from "@/ui/motion/PageTransition";
import { HeaderActions } from "../_components/HeaderActions";

export const metadata: Metadata = { title: "Settings" };

// Settings index (SPEC M21). Derived from every module's nav entries with section
// 'settings', filtered by permission and feature flag (BUILD_PLAN §3.3). On desktop
// the list lives in the settings column (layout.tsx); this page shows an overview.
export default async function SettingsIndexPage() {
  const user = await requireUser();
  const isManager = user.perms.has("settings.manage");
  const [groups, company, settings, setup, counts] = await Promise.all([
    settingsGroupsFor(user),
    findCompany(),
    getSettings(),
    isManager ? getSetupChecklist(user.id) : Promise.resolve(null),
    isManager
      ? execRows<{
          users: number;
          services: number;
          tags: number;
          fields: number;
        }>(sql`
          select
            (select count(*)::int from users where status = 'active') as users,
            (select count(*)::int from service_types where deleted_at is null and active) as services,
            (select count(*)::int from tags) as tags,
            (select count(*)::int from custom_field_defs where active) as fields
        `).then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);
  const brand = settings.branding.app_name || company?.name || "Your business";
  const addr = company?.address;

  return (
    <PageTransition>
      <LargeTitleHeader
        title="Settings"
        className="lg:hidden"
        trailing={<HeaderActions create={false} />}
      />
      <Page className="lg:pt-8">
        <div className="lg:hidden">
          <SettingsIndexList groups={groups} />
          {setup?.dismissed && setup.done < setup.total && (
            <div className="mt-6 flex justify-center">
              <ReopenSetupButton />
            </div>
          )}
        </div>

        <div className="hidden flex-col gap-6 lg:flex">
          <section className="flex items-center gap-4 rounded-card bg-card p-5 shadow-card">
            <span
              aria-hidden
              className="flex size-14 items-center justify-center rounded-[14px] bg-accent text-on-accent"
            >
              <Building size={28} />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-title2 font-bold tracking-tight">
                {brand}
              </h1>
              <p className="truncate text-subhead text-label-2">
                {[
                  addr?.city && addr?.state
                    ? `${addr.city}, ${addr.state}`
                    : null,
                  company?.timezone,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Add your address in Company"}
              </p>
            </div>
            {isManager && (
              <Button href="/settings/company" variant="gray" size="sm">
                Edit profile
              </Button>
            )}
          </section>

          {counts && (
            <div className="grid grid-cols-4 gap-3">
              <StatCard label="Active team" value={counts.users} href="/team" />
              <StatCard
                label="Service types"
                value={counts.services}
                href="/settings/services"
              />
              <StatCard
                label="Tags"
                value={counts.tags}
                href="/settings/tags"
              />
              <StatCard
                label="Custom fields"
                value={counts.fields}
                href="/settings/custom-fields"
              />
            </div>
          )}

          {setup && !setup.dismissed && setup.done < setup.total ? (
            <SetupChecklistCard checklist={setup} canEdit={isManager} />
          ) : setup && setup.done < setup.total ? (
            <div>
              <ReopenSetupButton />
            </div>
          ) : (
            <p className="px-1 text-subhead text-label-2">
              Pick a section on the left to change how {brand} works.
            </p>
          )}
        </div>
      </Page>
    </PageTransition>
  );
}
