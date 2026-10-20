import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CopyBlock } from "@/features/leads/components/CopyBlock";
import { Screen } from "@/features/leads/components/Screen";
import {
  RotateKeyButton,
  SourceSettingsForm,
} from "@/features/leads/components/SourceSettings";
import {
  MappingEditor,
  SnippetTabs,
  SpendEditor,
  TestConsole,
} from "@/features/leads/components/SourceTools";
import { PRESET_SAMPLES } from "@/features/leads/intake/presets";
import { turnstileSiteKey } from "@/features/leads/keys";
import { INTEGRATION_LABEL, PRESET_LABEL } from "@/features/leads/labels";
import {
  getLeadSource,
  listSourceSpend,
  recentPayloads,
  sourceRoi,
} from "@/features/leads/queries";
import { buildSnippets } from "@/features/leads/snippets";
import { listServiceTypes } from "@/features/settings/api";
import { requireUser } from "@/lib/auth/current";
import { appUrl } from "@/lib/env";
import { NotFoundError } from "@/lib/errors";
import { getSecret } from "@/lib/secrets";
import { findCompany, getSettings, isEnabled } from "@/lib/settings";
import { ListGroup, ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { StatCard } from "@/ui/components/StatCard";

export const metadata: Metadata = { title: "Lead source" };

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-4 text-subhead font-semibold text-label-2">{title}</h2>
      {children}
    </section>
  );
}

export default async function LeadSourcePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser("settings.api_keys");
  if (!(await isEnabled("leads"))) notFound();
  const { id } = await params;
  let src: Awaited<ReturnType<typeof getLeadSource>>;
  try {
    src = await getLeadSource(user, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const [payloads, spend, roi, settings, company, services, tsSecretSet] =
    await Promise.all([
      recentPayloads(user, src.id, 20),
      listSourceSpend(src.id),
      sourceRoi(src.id, 3),
      getSettings(),
      findCompany(),
      listServiceTypes().catch(() => []),
      getSecret("TURNSTILE_SECRET")
        .then(Boolean)
        .catch(() => false),
    ]);
  const snippets = buildSnippets({
    appUrl: appUrl(),
    publicKey: src.publicKey,
    companyName: settings.branding.app_name || company?.name || "us",
    consentText: settings.compliance.sms_consent_text,
    services: services.map((s) => s.name),
  });
  const initialLevel =
    src.integrationKind === "plain_form"
      ? "plain"
      : src.integrationKind === "js_snippet"
        ? "snippet"
        : src.integrationKind === "hosted_form"
          ? "hosted"
          : "api";
  const lastReceived = payloads.find((p) => p.kind !== "touch") ?? payloads[0];
  const sample = JSON.stringify(
    PRESET_SAMPLES[(src.preset as keyof typeof PRESET_SAMPLES) ?? "generic"] ??
      PRESET_SAMPLES.generic,
    null,
    2,
  );
  const cpl = roi.leads ? Math.round(roi.spendCents / roi.leads) : null;
  const cpb = roi.booked ? Math.round(roi.spendCents / roi.booked) : null;

  return (
    <Screen
      title={src.name}
      back={{ href: "/settings/lead-sources", label: "Lead sources" }}
      intro={`${INTEGRATION_LABEL[src.integrationKind] ?? src.integrationKind}${
        src.integrationKind === "preset"
          ? ` · ${PRESET_LABEL[src.preset] ?? src.preset}`
          : ""
      }${src.active ? "" : " · turned off"}`}
    >
      <ListGroup>
        {src.integrationKind !== "preset" && (
          <Section title="Add it to your website">
            <SnippetTabs
              snippets={snippets}
              initial={initialLevel}
              requireTs={src.requireTs}
            />
          </Section>
        )}

        <Section title="Keys">
          <div className="flex flex-col gap-2">
            {src.publicKey && (
              <CopyBlock label="Public site key" value={src.publicKey} />
            )}
          </div>
          <ListSection footer="Secret keys and webhook URLs are shown once when created. Rotate to get a new one; the old one stops working right away.">
            {src.publicKey && (
              <RotateKeyButton
                sourceId={src.id}
                which="public"
                label="Rotate site key"
              />
            )}
            {(src.secretHash || src.integrationKind === "json_api") && (
              <RotateKeyButton
                sourceId={src.id}
                which="secret"
                label={
                  src.secretHash
                    ? "Rotate secret key (sk_…)"
                    : "Create secret key (sk_…)"
                }
              />
            )}
            {(src.hookSecretHash || src.integrationKind === "preset") && (
              <RotateKeyButton
                sourceId={src.id}
                which="hook"
                label={
                  src.hookSecretHash
                    ? "Rotate webhook URL"
                    : "Create webhook URL"
                }
              />
            )}
            {src.preset === "google_ads_leadform" && (
              <RotateKeyButton
                sourceId={src.id}
                which="google"
                label={
                  src.googleKeyHash
                    ? "Rotate Google lead form key"
                    : "Create Google lead form key"
                }
              />
            )}
          </ListSection>
          {src.integrationKind === "preset" && (
            <p className="px-4 text-footnote text-label-2">
              Paste the webhook URL into{" "}
              {PRESET_LABEL[src.preset] ?? "the service"}'s webhook / “POST to
              URL” setting.
              {src.preset === "google_ads_leadform"
                ? " In Google Ads → Lead form → Webhook, use the same URL and the Google key above."
                : ""}
            </p>
          )}
        </Section>

        <Section title="Received payloads (test console)">
          <TestConsole
            sourceId={src.id}
            sample={sample}
            payloads={payloads.map((p) => ({
              id: p.id,
              kind: p.kind,
              outcome: p.outcome,
              leadId: p.leadId,
              at: p.createdAt,
              ip: p.ip,
              raw: JSON.stringify(p.raw ?? null, null, 2).slice(0, 8000),
            }))}
          />
        </Section>

        <Section title="Field mapping">
          <MappingEditor
            sourceId={src.id}
            initial={src.mapping ?? null}
            lastEventId={lastReceived?.id ?? null}
          />
        </Section>

        <Section title="Last 3 months">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard label="Leads" value={roi.leads} />
            <StatCard label="Booked" value={roi.booked} />
            <StatCard
              label="Spend"
              value={<MoneyText cents={roi.spendCents} compactWhole />}
            />
            <StatCard
              label="Revenue"
              value={<MoneyText cents={roi.revenueCents} compactWhole />}
            />
          </div>
          {(cpl != null || cpb != null) && roi.spendCents > 0 && (
            <ListSection>
              {cpl != null && (
                <ListRow
                  title="Cost per lead"
                  detail={<MoneyText cents={cpl} />}
                />
              )}
              {cpb != null && (
                <ListRow
                  title="Cost per booked job"
                  detail={<MoneyText cents={cpb} />}
                />
              )}
            </ListSection>
          )}
        </Section>

        {
          <Section title="Monthly spend">
            <SpendEditor
              sourceId={src.id}
              rows={spend.map((r) => ({
                id: r.id,
                month: r.month,
                amountCents: Number(r.amountCents),
                notes: r.notes,
              }))}
            />
          </Section>
        }

        <Section title="Settings">
          <SourceSettingsForm
            turnstileConfigured={!!turnstileSiteKey() && tsSecretSet}
            source={{
              id: src.id,
              name: src.name,
              kind: src.kind,
              integrationKind: src.integrationKind as never,
              preset: src.preset,
              allowedOrigins: src.allowedOrigins ?? [],
              requireTs: src.requireTs,
              turnstileRequired: src.turnstileRequired,
              dailyCap: src.dailyCap,
              costModel: src.costModel as "none" | "per_lead" | "monthly",
              defaultCostCents:
                src.defaultCostCents == null
                  ? null
                  : Number(src.defaultCostCents),
              active: src.active,
            }}
          />
        </Section>
      </ListGroup>
    </Screen>
  );
}
