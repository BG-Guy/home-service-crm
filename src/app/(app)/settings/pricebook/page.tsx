import type { Metadata } from "next";
import { PricebookManager } from "@/features/pricebook/components/PricebookManager";
import { listPricebookItems } from "@/features/pricebook/queries";
import { requireUser } from "@/lib/auth/current";
import { getSettings } from "@/lib/settings";
import { Page } from "@/ui/components/AppShell";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Price book" };

// Settings → Price book (SPEC M21; BUILD_PLAN §9 B3): items CRUD, categories, the
// markup matrix (settings.parts.markup_tiers) and CSV import/export.
export default async function SettingsPricebookPage() {
  await requireUser("pricebook.manage");
  const [items, settings] = await Promise.all([
    listPricebookItems(),
    getSettings(),
  ]);
  return (
    <PageTransition>
      <LargeTitleHeader
        title="Price book"
        subtitle={`${items.filter((i) => i.active).length} active items`}
        back={{ href: "/settings", label: "Settings" }}
      />
      <Page>
        <PricebookManager items={items} tiers={settings.parts.markup_tiers} />
      </Page>
    </PageTransition>
  );
}
