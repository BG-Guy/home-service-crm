import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { modules } from "@/features/registry";
import type { GridSection } from "@/features/settings/components/PermissionGrid";
import { SettingsScreen } from "@/features/settings/components/SettingsScreen";
import { UserOverrides } from "@/features/settings/components/UserOverrides";
import { permDescription, permLabel } from "@/features/settings/perm-labels";
import {
  getRoleGrid,
  getUserForPermissions,
  getUserOverrides,
} from "@/features/settings/queries";
import { requireUser } from "@/lib/auth/current";
import { personHref } from "@/lib/links";
import {
  ADMIN_LOCKED_PERMS,
  ADMIN_ONLY_OVERRIDE_PERMS,
  DEFAULT_GRANTS,
  PERMISSIONS_BY_MODULE,
  type Perm,
  toBaseRole,
} from "@/lib/permissions";
import { Avatar } from "@/ui/components/Avatar";
import { Banner } from "@/ui/components/Banner";
import { TextLink } from "@/ui/components/TextLink";

export const metadata: Metadata = { title: "Permission overrides" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Settings → Permissions → one person (SPEC §4.1): Inherit / Allow / Deny per key.
export default async function UserPermissionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireUser("settings.permissions");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [u, overrides, explicit] = await Promise.all([
    getUserForPermissions(id),
    getUserOverrides(id),
    getRoleGrid(),
  ]);
  if (!u) notFound();
  const base = toBaseRole(u.baseRole ?? u.role);
  const sections: GridSection[] = Object.entries(PERMISSIONS_BY_MODULE)
    .map(([key, grants]) => ({
      key,
      name: modules.find((m) => m.key === key)?.name ?? key,
      flagOff: false,
      perms: Object.keys(grants).map((p) => ({
        key: p,
        label: permLabel(p),
        description: permDescription(p),
      })),
    }))
    .filter((s) => s.perms.length > 0);
  const roleGrants: Record<string, boolean> = {};
  for (const s of sections)
    for (const p of s.perms)
      roleGrants[p.key] =
        explicit[u.role]?.[p.key] ?? DEFAULT_GRANTS[base].has(p.key as Perm);
  const isSelf = viewer.id === u.id;

  return (
    <SettingsScreen
      title={u.name}
      back={{ href: "/settings/permissions", label: "Permissions" }}
    >
      <div className="flex flex-col gap-[var(--section-gap)]">
        <div className="flex items-center gap-3 px-4">
          <Avatar name={u.name} seed={u.id} size={48} />
          <div className="min-w-0">
            <p className="truncate text-headline">
              <TextLink href={personHref(viewer, u.id)}>{u.name}</TextLink>
            </p>
            <p className="truncate text-subhead text-label-2">
              {u.roleName ?? u.role} · {u.email}
            </p>
          </div>
        </div>
        {u.status === "deactivated" && (
          <Banner tone="offline">
            Deactivated — overrides apply again if they are reactivated.
          </Banner>
        )}
        {isSelf && (
          <Banner tone="warning">
            These are your own permissions. You can't deny yourself access to
            Permissions.
          </Banner>
        )}
        <UserOverrides
          userId={u.id}
          roleName={u.roleName ?? u.role}
          sections={sections}
          roleGrants={roleGrants}
          overrides={Object.fromEntries(
            overrides.map((o) => [o.perm, o.effect]),
          )}
          lockAllow={base === "admin" ? [] : [...ADMIN_ONLY_OVERRIDE_PERMS]}
          lockDeny={
            base === "admin"
              ? [...ADMIN_LOCKED_PERMS]
              : isSelf
                ? ["settings.permissions"]
                : []
          }
        />
      </div>
    </SettingsScreen>
  );
}
