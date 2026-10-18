import type { Metadata } from "next";
import { listTemplates } from "@/features/automations/queries";
import { PushedScreen } from "@/features/messaging/components/PushedScreen";
import { channelLabel } from "@/features/messaging/labels";
import { requireUser } from "@/lib/auth/current";
import { ListRow, ListSection } from "@/ui/components/List";
import { Pill } from "@/ui/components/StatusPill";

export const metadata: Metadata = { title: "Templates" };

const PURPOSE: Record<string, string> = {
  transactional: "Service",
  marketing: "Marketing",
  review: "Review",
  internal: "Team",
};

// Settings → Templates (SPEC M13): every message the system sends, per channel.
export default async function SettingsTemplatesPage() {
  await requireUser("templates.manage");
  const all = await listTemplates();
  const groups = [
    {
      title: "Customer messages",
      items: all.filter((t) => !t.staff && !t.key.startsWith("user.")),
    },
    {
      title: "Team notifications",
      items: all.filter((t) => t.key.startsWith("staff.")),
    },
    {
      title: "Account emails",
      items: all.filter(
        (t) =>
          t.key.startsWith("user.") || (t.staff && !t.key.startsWith("staff.")),
      ),
    },
  ];
  return (
    <PushedScreen
      title="Templates"
      intro="The words every text, email and notification uses. Edits apply to the next message sent; you can always reset to the original."
    >
      <div className="flex flex-col gap-[var(--section-gap)]">
        {groups
          .filter((g) => g.items.length > 0)
          .map((g) => (
            <ListSection key={g.title} header={g.title}>
              {g.items.map((t) => (
                <ListRow
                  key={t.key}
                  title={t.label}
                  subtitle={`${t.key} · ${t.channels.map(channelLabel).join(", ")}`}
                  detail={
                    <span className="flex gap-1">
                      {t.edited && (
                        <Pill tone="blue" size="sm">
                          Edited
                        </Pill>
                      )}
                      <Pill
                        tone={t.purpose === "marketing" ? "orange" : "gray"}
                        size="sm"
                      >
                        {PURPOSE[t.purpose] ?? t.purpose}
                      </Pill>
                    </span>
                  }
                  href={`/settings/templates/${encodeURIComponent(t.key)}`}
                />
              ))}
            </ListSection>
          ))}
      </div>
    </PushedScreen>
  );
}
