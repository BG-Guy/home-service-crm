import { Users } from "lucide-react";
import type { Metadata } from "next";
import { UrlSegmented } from "@/features/settings/components/UrlSegmented";
import {
  InviteButton,
  PendingInvites,
} from "@/features/team/components/Invites";
import { TeamRow } from "@/features/team/components/TeamRow";
import {
  countTeam,
  listPendingInvites,
  listRoleOptions,
  listTeam,
  type TeamStatusFilter,
} from "@/features/team/queries";
import { requireAnyPerm } from "@/lib/auth/current";
import { Page } from "@/ui/components/AppShell";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListSection } from "@/ui/components/List";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";
import { HeaderActions } from "../_components/HeaderActions";

export const metadata: Metadata = { title: "Team" };

const FILTERS: TeamStatusFilter[] = ["active", "invited", "deactivated"];

// Team list (SPEC M02; BUILD_PLAN §9 B8): avatar, role, status, worker type, clocked
// in (B2 batch), cash held (B6 batch), agreement and tool-audit status; invite sheet.
export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requireAnyPerm(["users.manage", "users.invite"]);
  const sp = await searchParams;
  const status: TeamStatusFilter = FILTERS.includes(
    sp.status as TeamStatusFilter,
  )
    ? (sp.status as TeamStatusFilter)
    : "active";
  const canInvite = user.perms.has("users.invite");
  const canManage = user.perms.has("users.manage");
  const [members, invites, counts, roles] = await Promise.all([
    listTeam(user, status),
    status === "invited" ? listPendingInvites() : Promise.resolve([]),
    countTeam(),
    listRoleOptions(),
  ]);
  const roleOptions = roles.filter((r) => canManage || r.baseRole !== "admin");
  const groups =
    status === "active"
      ? (
          [
            ["admin", "Admins"],
            ["office", "Office"],
            ["tech", "Technicians"],
          ] as const
        )
          .map(([key, label]) => ({
            key,
            label,
            rows: members.filter((m) => m.baseRole === key),
          }))
          .filter((g) => g.rows.length > 0)
      : [{ key: status, label: undefined, rows: members }];
  const clockedIn = members.filter((m) => m.clockedInSince).length;

  return (
    <PageTransition>
      <LargeTitleHeader
        title="Team"
        subtitle={
          status === "active"
            ? `${counts.active} active${clockedIn ? ` · ${clockedIn} clocked in` : ""}`
            : undefined
        }
        trailing={
          <>
            {canInvite && <InviteButton roles={roleOptions} variant="plain" />}
            <HeaderActions create={false} />
          </>
        }
      >
        <UrlSegmented
          param="status"
          value={status}
          defaultValue="active"
          label="Show"
          segments={[
            { value: "active", label: "Active" },
            {
              value: "invited",
              label: counts.invited ? `Invited (${counts.invited})` : "Invited",
            },
            { value: "deactivated", label: "Deactivated" },
          ]}
        />
      </LargeTitleHeader>
      <Page className="pt-2">
        <div className="flex flex-col gap-[var(--section-gap)]">
          {status === "invited" && (
            <PendingInvites
              canInvite={canInvite}
              invites={invites.map((i) => ({
                id: i.id,
                name: i.name,
                email: i.email,
                phone: i.phone,
                roleName: i.roleName,
                workerType: i.workerType,
                expiresAt: i.expiresAt.toISOString(),
                expired: i.expired,
              }))}
            />
          )}
          {groups.map((g) =>
            g.rows.length ? (
              <ListSection key={g.key} header={g.label}>
                {g.rows.map((m) => (
                  <TeamRow key={m.id} m={m} linkable={canManage} />
                ))}
              </ListSection>
            ) : null,
          )}
          {members.length === 0 &&
            (status !== "invited" || invites.length === 0) && (
              <EmptyState
                icon={<Users size={44} strokeWidth={1.5} />}
                title={
                  status === "deactivated"
                    ? "No one is deactivated"
                    : status === "invited"
                      ? "No pending invites"
                      : "No team members yet"
                }
                message={
                  status === "deactivated"
                    ? "People you deactivate keep their history and show up here."
                    : "Invite technicians and office staff. They get a link to set a password."
                }
                action={
                  canInvite && status !== "deactivated" ? (
                    <InviteButton roles={roleOptions} label="Invite someone" />
                  ) : undefined
                }
              />
            )}
        </div>
      </Page>
    </PageTransition>
  );
}
