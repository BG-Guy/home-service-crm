// Module registry (SPEC §15.1). Every module registers here with one line; the
// permission union, nav, settings schema, feature-flags page and seeds derive from it.
// Server-side import only for the manifests (they're pure data, but pull zod); client
// code should import types only.
//
// Runtime hooks live in fixed-path files per BUILD_PLAN §4 and are aggregated by F
// elsewhere (to keep this file free of module runtime code and import cycles):
//   events.ts  → src/lib/event-handlers.ts   cron.ts    → src/lib/cron-hooks.ts
//   workers.ts → src/lib/workers.ts          ai.ts      → src/adapters/ai/handlers.ts
//   badges.ts  → src/lib/badges.ts           seed.ts    → src/db/seed/demo.ts
import { z } from "zod";
import type { BaseRole } from "@/db/enums";
import type { AutomationStep } from "@/db/schema/messaging";
import type { EventType } from "@/lib/event-types";
import {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAG_DEFS,
  type FeatureFlag,
  type FeatureFlags,
} from "@/lib/flags";
import type { Perm } from "@/lib/permissions";
import { manifest as auth } from "./auth/manifest";
import { settingsShape as authSettings } from "./auth/settings";
import { manifest as automations } from "./automations/manifest";
import { manifest as customers } from "./customers/manifest";
import { manifest as data } from "./data/manifest";
import { settingsShape as dataSettings } from "./data/settings";
import { manifest as disputes } from "./disputes/manifest";
import { settingsShape as disputesSettings } from "./disputes/settings";
import { manifest as estimates } from "./estimates/manifest";
import { settingsShape as estimatesSettings } from "./estimates/settings";
import { manifest as insights } from "./insights/manifest";
import { settingsShape as insightsSettings } from "./insights/settings";
import { manifest as invoices } from "./invoices/manifest";
import { settingsShape as invoicesSettings } from "./invoices/settings";
import { manifest as jobs } from "./jobs/manifest";
import { settingsShape as jobsSettings } from "./jobs/settings";
import { manifest as leads } from "./leads/manifest";
import { settingsShape as leadsSettings } from "./leads/settings";
import { manifest as map } from "./map/manifest";
import { settingsShape as mapSettings } from "./map/settings";
import { manifest as media } from "./media/manifest";
import { settingsShape as mediaSettings } from "./media/settings";
import { manifest as messaging } from "./messaging/manifest";
import { settingsShape as messagingSettings } from "./messaging/settings";
import { manifest as notify } from "./notify/manifest";
import { settingsShape as notifySettings } from "./notify/settings";
import { manifest as parts } from "./parts/manifest";
import { settingsShape as partsSettings } from "./parts/settings";
import { manifest as payments } from "./payments/manifest";
import { settingsShape as paymentsSettings } from "./payments/settings";
import { manifest as payroll } from "./payroll/manifest";
import { settingsShape as payrollSettings } from "./payroll/settings";
import { manifest as portal } from "./portal/manifest";
import { settingsShape as portalSettings } from "./portal/settings";
import { manifest as reviews } from "./reviews/manifest";
import { settingsShape as reviewsSettings } from "./reviews/settings";
import { manifest as settings } from "./settings/manifest";
import { settingsShape as settingsSettings } from "./settings/settings";
import { manifest as team } from "./team/manifest";
import { manifest as tech } from "./tech/manifest";
import { manifest as tools } from "./tools/manifest";
import { settingsShape as toolsSettings } from "./tools/settings";
import { manifest as vehicles } from "./vehicles/manifest";
import { settingsShape as vehiclesSettings } from "./vehicles/settings";

// ------------------------------------------------------------------ types

export type ModuleKey =
  | "auth"
  | "team"
  | "customers"
  | "leads"
  | "jobs"
  | "tech"
  | "estimates"
  | "invoices"
  | "payments"
  | "disputes"
  | "media"
  | "messaging"
  | "automations"
  | "reviews"
  | "parts"
  | "payroll"
  | "vehicles"
  | "tools"
  | "map"
  | "insights"
  | "settings"
  | "notify"
  | "portal"
  | "data";

/** Desktop sidebar sections (§13.2). 'settings' = a settings page (also listed on /settings). */
export type SidebarSection =
  | "overview"
  | "work"
  | "customers"
  | "money"
  | "operations"
  | "settings";
/** Mobile "More" groups (§13.1). */
export type MoreGroup =
  | "work"
  | "team"
  | "fleet"
  | "insights"
  | "account"
  | "admin";
/** Groups on the /settings index. */
export type SettingsGroup =
  | "business"
  | "work"
  | "money"
  | "communication"
  | "team"
  | "fleet"
  | "system";
/** Nav badge keys (BUILD_PLAN Appendix D); counts come from each module's badges.ts. */
export type BadgeKey =
  | "leads.new"
  | "messages.outbox"
  | "notifications.unread"
  | "approvals.pending"
  | "tasks.due"
  | "invoices.overdue"
  | "disputes.open"
  | "jobs.needs_tech";

export interface NavItem {
  /** Unique across all modules, e.g. 'jobs', 'settings.payments'. */
  key: string;
  href: string;
  label: string;
  /** Icon key from src/ui/icons.ts (e.g. 'today', 'jobs', 'settings'). */
  icon: string;
  /** Required permission; an array means ANY of them. Omitted = every signed-in user. */
  perm?: Perm | readonly Perm[];
  flag?: FeatureFlag;
  /** Restrict to these base roles. */
  roles?: readonly BaseRole[];
  /** Per-role overrides of label/href/icon (e.g. admin "Home" → /insights). */
  byRole?: Partial<
    Record<BaseRole, { label?: string; href?: string; icon?: string }>
  >;
  /** Mobile tab-bar slot (1–4) per base role (§13.1). Tab 5 is always More. */
  tabPriority?: Partial<Record<BaseRole, number>>;
  /** Desktop sidebar section and order (§13.2). */
  section?: SidebarSection;
  order?: number;
  /** Mobile More list group and order (§13.1). Items shown as tabs are omitted from More. */
  more?: MoreGroup;
  moreOrder?: number;
  moreLabel?: string;
  /** Settings index grouping (only for section 'settings'). */
  settingsGroup?: SettingsGroup;
  description?: string;
  badge?: BadgeKey;
  /** Special rows: sign out (POST /api/auth/logout) and the install-app sheet. */
  action?: "signout" | "install";
}

/** Built-in message template seed (message_templates row). */
export interface TemplateSeed {
  key: string;
  channel: "sms" | "email" | "push" | "in_app";
  purpose: "transactional" | "marketing" | "review" | "internal";
  locale?: string;
  subject?: string | null;
  body: string;
  expiresAfterMinutes?: number | null;
  allowOutsideQuietHours?: boolean;
}

/** Built-in automation seed (automations row, §7.3). */
export interface AutomationSeed {
  key: string;
  name: string;
  description?: string | null;
  triggerEvent: EventType | string;
  conditions?: Record<string, unknown>;
  steps: AutomationStep[];
  cancelOn?: unknown[];
  featureFlag?: FeatureFlag | null;
  enabled?: boolean;
}

export interface ModuleManifest {
  key: ModuleKey;
  name: string;
  description: string;
  /** Builder group that owns the module (F, B1…B8). */
  owner: string;
  /** All flags the module declares (media and parts declare two). */
  flags: readonly { readonly key: FeatureFlag; readonly default: boolean }[];
  /** First flag, for §15.1 compatibility. */
  flag?: { readonly key: FeatureFlag; readonly default: boolean };
  permissions: readonly Perm[];
  defaultGrants: Partial<Record<BaseRole, readonly Perm[]>>;
  nav: readonly NavItem[];
  settings?: {
    schema: z.ZodObject;
    defaults: Record<string, unknown>;
    page?: string;
  };
  events: { emits: readonly EventType[] };
  automations?: AutomationSeed[];
  templates?: TemplateSeed[];
  customFieldEntities?: readonly string[];
  dependsOn?: readonly ModuleKey[];
  /** Satellite dirs whose perms/nav/settings live in this manifest (BUILD_PLAN §3). */
  satellites?: readonly string[];
}

// ------------------------------------------------------------------ registry

export const modules: readonly ModuleManifest[] = [
  auth,
  team,
  customers,
  leads,
  jobs,
  tech,
  estimates,
  invoices,
  payments,
  disputes,
  media,
  messaging,
  automations,
  reviews,
  parts,
  payroll,
  vehicles,
  tools,
  map,
  insights,
  settings,
  notify,
  portal,
  data,
];

export function getModule(key: ModuleKey): ModuleManifest {
  const m = modules.find((x) => x.key === key);
  if (!m) throw new Error(`Unknown module ${key}`);
  return m;
}

/** Every nav item from every module. */
export function allNavItems(): NavItem[] {
  return modules.flatMap((m) => m.nav);
}

// ------------------------------------------------------------------ settings schema

const featuresSchema = z
  .object(
    Object.fromEntries(
      FEATURE_FLAG_DEFS.map((f) => [f.key, z.boolean().default(f.default)]),
    ) as Record<FeatureFlag, z.ZodDefault<z.ZodBoolean>>,
  )
  .prefault({});

/**
 * CompanySettings zod schema: `features` (derived from manifests) + every module's
 * namespaces. Unknown keys are dropped; missing keys take their defaults.
 */
export const settingsSchema = z.object({
  features: featuresSchema,
  ...authSettings,
  ...settingsSettings,
  ...insightsSettings,
  ...leadsSettings,
  ...dataSettings,
  ...jobsSettings,
  ...estimatesSettings,
  ...invoicesSettings,
  ...portalSettings,
  ...paymentsSettings,
  ...disputesSettings,
  ...mediaSettings,
  ...messagingSettings,
  ...reviewsSettings,
  ...notifySettings,
  ...partsSettings,
  ...payrollSettings,
  ...vehiclesSettings,
  ...toolsSettings,
  ...mapSettings,
});

export type CompanySettings = z.infer<typeof settingsSchema>;
export type SettingsNamespace = keyof CompanySettings;

/** Defaults for every namespace (parse of {}). */
export function defaultSettings(): CompanySettings {
  return settingsSchema.parse({});
}

export function defaultFeatureFlags(): FeatureFlags {
  return { ...DEFAULT_FEATURE_FLAGS };
}
