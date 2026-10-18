import type { Metadata } from "next";
import { SettingsScreen } from "@/features/settings/components/SettingsScreen";
import { TagsManager } from "@/features/settings/components/TagsManager";
import { listTagsWithUsage } from "@/features/settings/queries";
import { requireUser } from "@/lib/auth/current";

export const metadata: Metadata = { title: "Tags" };

// Settings → Tags (SPEC M21): name, color, applies-to; usage counts; delete.
export default async function SettingsTagsPage() {
  await requireUser("tags.manage");
  const tags = await listTagsWithUsage();
  return (
    <SettingsScreen
      title="Tags"
      intro="Custom labels for customers, jobs, leads, estimates, invoices, vehicles and tools."
    >
      <TagsManager tags={tags} />
    </SettingsScreen>
  );
}
