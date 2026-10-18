"use client";

import {
  Check,
  Copy,
  KeyRound,
  Mail,
  ShieldCheck,
  UserCheck,
  UserX,
} from "lucide-react";
import { useState, useTransition } from "react";
import { ActionSheet } from "@/ui/components/ActionSheet";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { ListRow, ListSection } from "@/ui/components/List";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import {
  changeRoleAction,
  createResetLinkAction,
  deactivateUserAction,
  reactivateUserAction,
} from "../actions";

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
          onClick={deactivated ? undefined : () => setPick(true)}
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

function ResetSheet({
  name,
  link,
  onCreate,
  onClosed,
}: {
  name: string;
  link: { url: string; expiresAt: string; emailed: boolean } | null;
  onCreate: (email: boolean) => void;
  onClosed: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      onClosed={onClosed}
      title="Reset password"
      detents={["content"]}
      trailing={
        <Button
          variant="plain"
          size="sm"
          className="font-semibold"
          onClick={() => setOpen(false)}
        >
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-5 pb-6">
        {!link ? (
          <>
            <p className="px-4 text-subhead text-label-2">
              A single-use link lets {name.split(" ")[0]} choose a new password.
              It expires in 30 minutes. Their current password keeps working
              until they use it.
            </p>
            <div className="flex flex-col gap-2 px-4">
              <Button fullWidth onClick={() => onCreate(true)}>
                Email the link
              </Button>
              <Button variant="gray" fullWidth onClick={() => onCreate(false)}>
                Create a link to share
              </Button>
            </div>
          </>
        ) : (
          <section className="px-0">
            <h2 className="px-4 pb-1.5 text-footnote uppercase text-label-2">
              {link.emailed
                ? "Emailed — you can also share"
                : "Share this link"}
            </h2>
            <div className="flex flex-col gap-3 rounded-card bg-card p-4">
              <code className="select-all break-all rounded-lg bg-fill-3 px-3 py-2 text-footnote">
                {link.url}
              </code>
              <Button
                variant="tinted"
                size="sm"
                icon={
                  copied ? (
                    <Check aria-hidden size={16} />
                  ) : (
                    <Copy aria-hidden size={16} />
                  )
                }
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link.url);
                    setCopied(true);
                    toast.success("Link copied");
                  } catch {
                    toast.error("Couldn't copy. Select the link instead.");
                  }
                }}
              >
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
            <p className="px-4 pt-1.5 text-footnote text-label-2">
              Expires{" "}
              {new Date(link.expiresAt).toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}
              . Share it only with {name.split(" ")[0]}.
            </p>
          </section>
        )}
      </div>
    </Sheet>
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
