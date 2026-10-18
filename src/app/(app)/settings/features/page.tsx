import type { Metadata } from "next";
import { modules } from "@/features/registry";
import {
  type FeatureRow,
  FeatureToggles,
} from "@/features/settings/components/FeatureToggles";
import { SettingsScreen } from "@/features/settings/components/SettingsScreen";
import { FEATURE_INFO } from "@/features/settings/feature-info";
import { requireUser } from "@/lib/auth/current";
import { FEATURE_FLAG_DEFS } from "@/lib/flags";
import { getFeatureFlags } from "@/lib/settings";
import { iconFor } from "@/ui/icons";
import type { Tone } from "@/ui/tone";

export const metadata: Metadata = { title: "Features" };

const GROUPS: { label: string; tone: Tone; keys: string[]; footer?: string }[] =
  [
    { label: "Sales", tone: "blue", keys: ["leads", "estimates", "reviews"] },
    {
      label: "Money",
      tone: "green",
      keys: ["deposits", "chargeback_protection", "payroll"],
    },
    {
      label: "In the field",
      tone: "orange",
      keys: ["photos", "before_after", "parts", "inventory"],
    },
    {
      label: "Fleet",
      tone: "brown",
      keys: ["vehicles", "tools", "map"],
      footer:
        "Turning a module off hides its screens and menu items for everyone and blocks its actions. Nothing is deleted; turn it back on any time.",
    },
  ];

// Settings → Features (SPEC §15.4): every manifest flag with a description.
export default async function SettingsFeaturesPage() {
  await requireUser("settings.features");
  const flags = await getFeatureFlags();
  const placed = new Set(GROUPS.flatMap((g) => g.keys));
  const known = FEATURE_FLAG_DEFS.map((f) => f.key as string);
  const row = (key: string, tone: Tone): FeatureRow => {
    const info = FEATURE_INFO[key];
    const mod = modules.find((m) => m.flags.some((f) => f.key === key));
    const Icon = iconFor(info?.icon ?? mod?.nav[0]?.icon ?? "settings");
    return {
      key,
      label: info?.label ?? mod?.name ?? key,
      description: info?.description ?? mod?.description ?? "",
      icon: <Icon size={17} aria-hidden />,
      tone,
      enabled: (flags as Record<string, boolean>)[key] ?? false,
      legal: info?.legal,
      requires: info?.requires,
      requiresLabel: info?.requires
        ? (FEATURE_INFO[info.requires]?.label ?? info.requires)
        : undefined,
    };
  };
  const groups = [
    ...GROUPS.map((g) => ({
      label: g.label,
      footer: g.footer,
      rows: g.keys.filter((k) => known.includes(k)).map((k) => row(k, g.tone)),
    })),
    {
      label: "Other",
      footer: undefined,
      rows: known.filter((k) => !placed.has(k)).map((k) => row(k, "gray")),
    },
  ].filter((g) => g.rows.length > 0);

  return (
    <SettingsScreen
      title="Features"
      intro="Turn optional modules on or off for this business. Only what you use shows up in the app."
    >
      <FeatureToggles groups={groups} />
    </SettingsScreen>
  );
}
