// Helper used by every module's manifest.ts to build a ModuleManifest from its
// permissions.ts / settings.ts / nav.ts files. Pure (no server imports) so the
// registry stays importable from server components without pulling module runtime code.
import { z } from "zod";
import type { BaseRole } from "@/db/enums";
import type { EventType } from "@/lib/event-types";
import type { FeatureFlag } from "@/lib/flags";
import type { Perm } from "@/lib/permissions";
import type {
  AutomationSeed,
  ModuleKey,
  ModuleManifest,
  NavItem,
  TemplateSeed,
} from "./registry";

const LETTERS: Record<BaseRole, string> = {
  admin: "A",
  office: "O",
  tech: "T",
};

export interface DefineModuleInput {
  key: ModuleKey;
  name: string;
  description: string;
  owner: string;
  grants: Readonly<Record<string, string>>;
  flags: readonly { readonly key: FeatureFlag; readonly default: boolean }[];
  settingsShape: Readonly<Record<string, z.ZodType>>;
  settingsPage?: string;
  nav?: readonly NavItem[];
  emits?: readonly EventType[];
  satellites?: readonly string[];
  automations?: AutomationSeed[];
  templates?: TemplateSeed[];
  customFieldEntities?: readonly string[];
  dependsOn?: readonly ModuleKey[];
}

export function defineModule(i: DefineModuleInput): ModuleManifest {
  const permissions = Object.keys(i.grants) as Perm[];
  const defaultGrants: Partial<Record<BaseRole, readonly Perm[]>> = {};
  for (const role of ["admin", "office", "tech"] as const) {
    defaultGrants[role] = permissions.filter((p) =>
      (i.grants[p] ?? "").includes(LETTERS[role]),
    );
  }
  const hasSettings = Object.keys(i.settingsShape).length > 0;
  const schema = z.object({ ...i.settingsShape });
  return {
    key: i.key,
    name: i.name,
    description: i.description,
    owner: i.owner,
    flags: i.flags,
    flag: i.flags[0],
    permissions,
    defaultGrants,
    nav: i.nav ?? [],
    settings: hasSettings
      ? {
          schema,
          defaults: schema.parse({}) as Record<string, unknown>,
          page: i.settingsPage,
        }
      : undefined,
    events: { emits: i.emits ?? [] },
    automations: i.automations,
    templates: i.templates,
    customFieldEntities: i.customFieldEntities,
    dependsOn: i.dependsOn,
    satellites: i.satellites,
  };
}
