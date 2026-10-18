import type { Metadata } from "next";
import { modules } from "@/features/registry";
import {
  type GridSection,
  PermissionGrid,
} from "@/features/settings/components/PermissionGrid";
import { SettingsScreen } from "@/features/settings/components/SettingsScreen";
import { permDescription, permLabel } from "@/features/settings/perm-labels";
import {
  getRoleGrid,
  listRoles,
  listUsersWithOverrideCounts,
} from "@/features/settings/queries";
import { requireUser } from "@/lib/auth/current";
import {
  ADMIN_LOCKED_PERMS,
  DEFAULT_GRANTS,
  PERMISSIONS_BY_MODULE,
  type Perm,
} from "@/lib/permissions";
import { getFeatureFlags } from "@/lib/settings";
import { Avatar } from "@/ui/components/Avatar";
import { ListRow, ListSection } from "@/ui/components/List";

export const metadata: Metadata = { title: "Permissions" };

// Settings → Permissions (SPEC §4.1): module × role grid from the manifests, with
// locks (admins keep settings.permissions and users.manage), plus the people list
// for per-user overrides. Every change is audited and emits permission.changed.
export default async function SettingsPermissionsPage() {
  await requireUser("settings.permissions");
  const [roles, explicit, people, flags] = await Promise.all([
    listRoles(),
    getRoleGrid(),
    listUsersWithOverrideCounts(),
    getFeatureFlags(),
  ]);
  const flagMap = flags as Record<string, boolean>;
  const sections: GridSection[] = Object.entries(PERMISSIONS_BY_MODULE)
    .map(([key, grants]) => {
      const mod = modules.find((m) => m.key === key);
      const flagOff = (mod?.flags ?? []).some((f) => flagMap[f.key] === false);
      return {
        key,
        name: mod?.name ?? key,
        flagOff,
        perms: Object.keys(grants).map((p) => ({
          key: p,
          label: permLabel(p),
          description: permDescription(p),
        })),
      };
    })
    .filter((s) => s.perms.length > 0);
  const allPerms = sections.flatMap((s) => s.perms.map((p) => p.key as Perm));
  const grid: Record<string, Record<string, boolean>> = {};
  const defaults: Record<string, Record<string, boolean>> = {};
  for (const r of roles) {
    const def = DEFAULT_GRANTS[r.baseRole];
    grid[r.key] = {};
    defaults[r.key] = {};
    for (const p of allPerms) {
      const d = def.has(p);
      (defaults[r.key] as Record<string, boolean>)[p] = d;
      (grid[r.key] as Record<string, boolean>)[p] = explicit[r.key]?.[p] ?? d;
    }
  }
  const nameOf = new Map(roles.map((r) => [r.key, r.name]));

  return (
    <SettingsScreen
      title="Permissions"
      wide
      intro={`What each role can see and do. Changes apply on the next tap — nobody has to sign out. Admins always keep “${permLabel("settings.permissions")}” and “${permLabel("users.manage")}”.`}
    >
      <div className="flex flex-col gap-[var(--section-gap)]">
        <PermissionGrid
          roles={roles}
          sections={sections}
          grid={grid}
          defaults={defaults}
          lockedForAdmin={[...ADMIN_LOCKED_PERMS]}
        />
        <ListSection
          header="People"
          footer="Override a single permission for one person (Allow or Deny wins over their role). Use sparingly — the role grid is easier to reason about."
        >
          {people.map((p) => (
            <ListRow
              key={p.userId}
              leading={<Avatar name={p.name} seed={p.userId} size={32} />}
              sepInset={60}
              title={p.name}
              subtitle={nameOf.get(p.role) ?? p.role}
              detail={
                p.overrides
                  ? `${p.overrides} override${p.overrides === 1 ? "" : "s"}`
                  : undefined
              }
              href={`/settings/permissions/users/${p.userId}`}
            />
          ))}
        </ListSection>
      </div>
    </SettingsScreen>
  );
}
