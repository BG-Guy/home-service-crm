"use client";

import { KeyRound, Mail, ShieldCheck, UserCheck, UserX } from "lucide-react";
import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { useConfirm } from "@/ui/components/Alert";
import { ListRow, ListSection } from "@/ui/components/List";
import { toast } from "@/ui/components/Toast";
import {
  changeRoleAction,
  createResetLinkAction,
  deactivateUserAction,
  reactivateUserAction,
} from "../actions";

// The role picker and the reset-link sheet load on first open.
const ActionSheet = dynamic(
  () => import("@/ui/components/ActionSheet").then((m) => m.ActionSheet),
  { ssr: false },
);
const ResetSheet = dynamic(() => import("./ResetLinkSheet"), { ssr: false });

export interface RoleChoice {
  key: string;
  name: string;
  baseRole: string;
}

/** "Role & access" section: role picker, overrides link, password reset link. */
export function AccessSection({
  userId,
  name,
  role,
  roles,
  overrideCount,
  canPermissions,
  isSelf,
  deactivated,
}: {
  userId: string;
  name: string;
  role: RoleChoice;
  roles: RoleChoice[];
  overrideCount: number;
  canPermissions: boolean;
  isSelf: boolean;
  deactivated: boolean;
}) {
  const [pick, setPick] = useState(false);
  const [picked, setPicked] = useState(false);
  const [, start] = useTransition();
  const [confirm, confirmEl] = useConfirm();
  const [reset, setReset] = useState<{
    url: string;
    expiresAt: string;
    emailed: boolean;
  } | null>(null);

  async function chooseRole(r: RoleChoice) {
    if (r.key === role.key) return;
    const toAdmin = r.baseRole === "admin";
    const fromAdmin = role.baseRole === "admin";
    if (toAdmin || fromAdmin || isSelf) {
      const ok = await confirm({
        title: `Change ${name.split(" ")[0]}'s role to ${r.name}?`,
        message: toAdmin
          ? "Admins see all money, can change permissions and manage everyone."
          : isSelf
            ? "You may lose access to this page."
            : "They lose admin access right away.",
        confirmLabel: "Change role",
        destructive: !toAdmin,
      });
      if (!ok) return;
    }
    start(async () => {
      const res = await changeRoleAction({ userId, role: r.key });
      if (res.ok) toast.success(`Role changed to ${r.name}`);
      else toast.error(res.error);
    });
  }

  function makeLink(email: boolean) {
    start(async () => {
      const res = await createResetLinkAction({ userId, email });
      if (res.ok && res.data) {
        setReset(res.data);
        if (res.data.emailed) toast.success("Reset link emailed");
      } else if (!res.ok) toast.error(res.error);
    });
  }

  return (
    <>
      {confirmEl}
      <ListSection
        header="Role & access"
        footer="Role changes and overrides take effect on their next tap — no sign-out needed."
      >
        <ListRow
          icon={<ShieldCheck size={17} aria-hidden />}
          iconTone="indigo"
          title="Role"
          detail={role.name}
          accessory="chevron"
          onClick={
            deactivated
              ? undefined
              : () => {
                  setPicked(true);
                  setPick(true);
                }
          }
          disabled={deactivated}
        />
        {canPermissions && (
          <ListRow
            icon={<KeyRound size={17} aria-hidden />}
            iconTone="gray"
            title="Permission overrides"
            detail={overrideCount ? `${overrideCount}` : "None"}
            href={`/settings/permissions/users/${userId}`}
          />
        )}
        {!deactivated && (
          <ListRow
            icon={<Mail size={17} aria-hidden />}
            iconTone="blue"
            title="Reset password"
            subtitle="Email a link, or copy one to share"
            accessory="chevron"
            onClick={() => setReset({ url: "", expiresAt: "", emailed: false })}
          />
        )}
      </ListSection>
      {picked && (
        <ActionSheet
          open={pick}
          onOpenChange={setPick}
          title="Change role"
          message="Permissions follow the role's grid in Settings → Permissions."
          items={roles.map((r) => ({
            label: r.key === role.key ? `${r.name} ✓` : r.name,
            onSelect: () => chooseRole(r),
          }))}
        />
      )}
      {reset && (
        <ResetSheet
          name={name}
          link={reset.url ? reset : null}
          onCreate={makeLink}
          onClosed={() => setReset(null)}
        />
      )}
    </>
  );
}

/** Deactivate (with consequences spelled out) or reactivate. */
export function StatusSection({
  userId,
  name,
  deactivated,
  awaitingApproval = false,
  isSelf,
}: {
  userId: string;
  name: string;
  deactivated: boolean;
  /** Open-signup account waiting for an admin (status `pending`). */
  awaitingApproval?: boolean;
  isSelf: boolean;
}) {
  const [pending, start] = useTransition();
  const [confirm, confirmEl] = useConfirm();
  if (isSelf) return null;
  async function deactivate() {
    const ok = await confirm({
      title: `Deactivate ${name}?`,
      message:
        "They're signed out everywhere right away and their phones stop getting notifications. Their jobs, pay and history are kept; you'll see a list of their open jobs to reassign.",
      confirmLabel: "Deactivate",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const r = await deactivateUserAction({ userId });
      if (r.ok)
        toast.success(`${name} deactivated`, {
          message: r.data
            ? `${r.data.sessions} session${r.data.sessions === 1 ? "" : "s"} ended`
            : undefined,
        });
      else toast.error(r.error);
    });
  }
  function reactivate() {
    start(async () => {
      const r = await reactivateUserAction({ userId });
      if (r.ok)
        toast.success(
          awaitingApproval ? `${name} approved` : `${name} reactivated`,
          {
            message: awaitingApproval
              ? "They can sign in now."
              : "They can sign in with their old password.",
          },
        );
      else toast.error(r.error);
    });
  }
  return (
    <>
      {confirmEl}
      <ListSection>
        {deactivated || awaitingApproval ? (
          <ListRow
            icon={<UserCheck size={17} aria-hidden />}
            iconTone="green"
            title={awaitingApproval ? "Approve access" : "Reactivate"}
            onClick={reactivate}
            disabled={pending}
          />
        ) : (
          <ListRow
            icon={<UserX size={17} aria-hidden />}
            iconTone="red"
            title="Deactivate"
            destructive
            onClick={deactivate}
            disabled={pending}
          />
        )}
      </ListSection>
    </>
  );
}
