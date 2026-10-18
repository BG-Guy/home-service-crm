import { Code, FileText, Globe, Plug, Webhook } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Screen } from "@/features/leads/components/Screen";
import {
  LeadSettingsForm,
  NewSourceButton,
} from "@/features/leads/components/SourceSettings";
import { INTEGRATION_LABEL } from "@/features/leads/labels";
import { listLeadSources } from "@/features/leads/queries";
import { requireUser } from "@/lib/auth/current";
import { getSettings, isEnabled } from "@/lib/settings";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListGroup, ListRow, ListSection } from "@/ui/components/List";

export const metadata: Metadata = { title: "Lead sources" };

const ICON = {
  plain_form: <FileText size={17} />,
  js_snippet: <Code size={17} />,
  hosted_form: <Globe size={17} />,
  json_api: <Plug size={17} />,
  preset: <Webhook size={17} />,
} as const;

// Settings → Lead sources (SPEC M04, BUILD_PLAN §9): sources with keys and snippets,
// plus the settings.leads section.
export default async function LeadSourcesPage() {
  const user = await requireUser("settings.api_keys");
  if (!(await isEnabled("leads"))) notFound();
  const [sources, s] = await Promise.all([
    listLeadSources(user),
    getSettings(),
  ]);
  return (
    <Screen
      title="Lead sources"
      intro="Where your leads come from. Each source gets its own key and a ready-to-paste form, script or API example."
    >
      <ListGroup>
        {sources.length === 0 ? (
          <div className="list-card">
            <EmptyState
              compact
              icon={<Globe size={40} strokeWidth={1.6} />}
              title="Connect your website"
              message="Add a source to get a contact form that drops leads straight into your inbox."
              action={<NewSourceButton />}
            />
          </div>
        ) : (
          <ListSection header="Sources" trailing={<NewSourceButton />}>
            {sources.map((src) => (
              <ListRow
                key={src.id}
                icon={ICON[src.integrationKind] ?? <Plug size={17} />}
                iconTone={src.active ? "blue" : "gray"}
                title={src.name}
                subtitle={`${INTEGRATION_LABEL[src.integrationKind] ?? src.integrationKind}${src.active ? "" : " · off"}`}
                detail={
                  src.leads30d
                    ? `${src.leads30d} lead${src.leads30d === 1 ? "" : "s"} · 30 d`
                    : "No leads yet"
                }
                href={`/settings/lead-sources/${src.id}`}
              />
            ))}
          </ListSection>
        )}
        <section className="flex flex-col gap-2">
          <h2 className="px-4 text-footnote uppercase text-label-2">
            Inbox rules
          </h2>
          <LeadSettingsForm
            initial={{
              assignment: s.leads.assignment,
              slaBusinessHours: s.leads.sla_business_hours,
              spamReviewThreshold: s.leads.spam_review_threshold,
              leadResponseMinutes: s.company.lead_response_minutes,
              lostReasons: s.leads.lost_reasons,
              defaultSourceId: s.leads.default_source_id,
            }}
            sources={sources
              .filter((x) => x.active)
              .map((x) => ({ id: x.id, name: x.name }))}
          />
        </section>
        <ListSection header="Server API keys">
          <ListRow
            title="API keys"
            subtitle="For Zapier, Make or your own backend (any source)"
            href="/settings/api-keys"
          />
        </ListSection>
      </ListGroup>
    </Screen>
  );
}
