"use client";

import { RotateCw, Trash2, UserPlus } from "lucide-react";
import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { ActionSheet } from "@/ui/components/ActionSheet";
import { useConfirm } from "@/ui/components/Alert";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { ListRow, ListSection } from "@/ui/components/List";
import { Pill } from "@/ui/components/StatusPill";
import { SwipeActions } from "@/ui/components/SwipeActions";
import { toast } from "@/ui/components/Toast";
import { resendInviteAction, revokeInviteAction } from "../actions";
import { workerTypeLabel } from "../rules";

import type { SentInvite } from "./InviteSent";

const loadInviteSheet = () => import("./InviteSheet");
const InviteSheet = dynamic(loadInviteSheet, { ssr: false });

export interface RoleOption {
  key: string;
  name: string;
  baseRole: string;
}

/* ------------------------------------------------------------------ button + sheet */

export function InviteButton({
  roles,
  variant = "filled",
  label = "Invite",
}: {
  roles: RoleOption[];
  variant?: "filled" | "plain" | "tinted";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const preload = () => void loadInviteSheet();
  return (
    <>
      <Button
        variant={variant}
        size="sm"
        icon={<UserPlus aria-hidden size={17} />}
        onPointerEnter={preload}
        onPointerDown={preload}
        onFocus={preload}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      {open && <InviteSheet roles={roles} onClosed={() => setOpen(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ pending list */

export interface InviteItem {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  roleName: string;
  workerType: string;
  expiresAt: string;
  expired: boolean;
}

export function PendingInvites({
  invites,
  canInvite,
}: {
  invites: InviteItem[];
  canInvite: boolean;
}) {
  const [, start] = useTransition();
  const [confirm, confirmEl] = useConfirm();
  const [lastLink, setLastLink] = useState<SentInvite | null>(null);
  const [menu, setMenu] = useState<InviteItem | null>(null);
  if (invites.length === 0) return null;
  function resend(i: InviteItem) {
    start(async () => {
      const r = await resendInviteAction({ inviteId: i.id });
      if (r.ok && r.data) {
        toast.success("New invite link sent", {
          message: r.data.emailed
            ? `Emailed to ${i.email}`
            : r.data.texted
              ? "Waiting in your outbox"
              : undefined,
        });
        setLastLink({ ...r.data, name: i.name });
      } else if (!r.ok) toast.error(r.error);
    });
  }
  async function revoke(i: InviteItem) {
    const ok = await confirm({
      title: `Revoke ${i.name}'s invite?`,
      message: "The link stops working right away.",
      confirmLabel: "Revoke",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const r = await revokeInviteAction({ inviteId: i.id });
      if (r.ok) toast.success("Invite revoked");
      else toast.error(r.error);
    });
  }
  return (
    <>
      {confirmEl}
      <ListSection
        header="Pending invites"
        footer={
          canInvite ? "Swipe an invite to resend or revoke it." : undefined
        }
      >
        {invites.map((i) => (
          <SwipeActions
            key={i.id}
            trailing={
              canInvite
                ? [
                    {
                      label: "Resend",
                      icon: <RotateCw aria-hidden size={18} />,
                      tone: "blue",
                      onAction: () => resend(i),
                    },
                    {
                      label: "Revoke",
                      icon: <Trash2 aria-hidden size={18} />,
                      tone: "red",
                      onAction: () => revoke(i),
                    },
                  ]
                : []
            }
          >
            <ListRow
              leading={
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-full border border-dashed border-[var(--sep-opaque)] text-label-3"
                >
                  <UserPlus size={18} />
                </span>
              }
              title={i.name}
              subtitle={`${i.roleName} · ${workerTypeLabel(i.workerType)} · ${i.email ?? formatPhoneDisplay(i.phone)}`}
              detail={
                i.expired ? (
                  <Pill tone="orange" size="sm">
                    Expired
                  </Pill>
                ) : (
                  <Pill tone="blue" size="sm">
                    Invited
                  </Pill>
                )
              }
              onClick={canInvite ? () => setMenu(i) : undefined}
              accessory="none"
            />
          </SwipeActions>
        ))}
      </ListSection>
      <ActionSheet
        open={menu != null}
        onOpenChange={(o) => !o && setMenu(null)}
        title={menu ? `Invite for ${menu.name}` : undefined}
        message={
          menu
            ? (menu.email ?? (formatPhoneDisplay(menu.phone) || undefined))
            : undefined
        }
        items={
          menu
            ? [
                { label: "Send a new link", onSelect: () => resend(menu) },
                {
                  label: "Revoke invite",
                  destructive: true,
                  onSelect: () => revoke(menu),
                },
              ]
            : []
        }
      />
      {lastLink && (
        <Banner
          tone="info"
          title={`New link for ${lastLink.name}`}
          onDismiss={() => setLastLink(null)}
          className="mt-3"
        >
          <span className="select-all break-all">{lastLink.url}</span>
        </Banner>
      )}
    </>
  );
}
