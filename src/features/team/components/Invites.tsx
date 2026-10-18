"use client";

import {
  Check,
  Copy,
  MessageSquare,
  RotateCw,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useState, useTransition } from "react";
import {
  FieldCard,
  FormErrors,
  FSelect,
  FText,
  useActionForm,
} from "@/features/settings/components/form";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { ActionSheet } from "@/ui/components/ActionSheet";
import { useConfirm } from "@/ui/components/Alert";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { ListRow, ListSection } from "@/ui/components/List";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { Pill } from "@/ui/components/StatusPill";
import { SwipeActions } from "@/ui/components/SwipeActions";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import {
  inviteUserAction,
  resendInviteAction,
  revokeInviteAction,
} from "../actions";
import { WORKER_TYPE_NOTES, workerTypeLabel } from "../rules";

export interface RoleOption {
  key: string;
  name: string;
  baseRole: string;
}

interface SentInvite {
  url: string;
  expiresAt: string;
  emailed: boolean;
  texted: boolean;
  smsHref: string | null;
  name: string;
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
  return (
    <>
      <Button
        variant={variant}
        size="sm"
        icon={<UserPlus aria-hidden size={17} />}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      {open && <InviteSheet roles={roles} onClosed={() => setOpen(false)} />}
    </>
  );
}

function InviteSheet({
  roles,
  onClosed,
}: {
  roles: RoleOption[];
  onClosed: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [sent, setSent] = useState<SentInvite | null>(null);
  const [worker, setWorker] = useState<"1099" | "w2">("1099");
  const [role, setRole] = useState(
    roles.find((r) => r.key === "tech")?.key ?? roles[0]?.key ?? "",
  );
  const [name, setName] = useState("");
  const [hasPhone, setHasPhone] = useState(false);
  const [hasEmail, setHasEmail] = useState(false);
  const f = useActionForm(inviteUserAction, {
    success: (d) =>
      d?.emailed
        ? "Invite emailed"
        : d?.texted
          ? "Invite added to your outbox"
          : "Invite created",
    onSuccess: (d) => d && setSent({ ...d, name }),
  });
  const base = roles.find((r) => r.key === role)?.baseRole;
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      onClosed={onClosed}
      title={sent ? "Invite ready" : "Invite to team"}
      detents={["large"]}
      leading={
        sent ? undefined : (
          <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        )
      }
      trailing={
        sent ? (
          <Button
            variant="plain"
            size="sm"
            className="font-semibold"
            onClick={() => setOpen(false)}
          >
            Done
          </Button>
        ) : (
          <Button
            variant="plain"
            size="sm"
            type="submit"
            form={f.id}
            loading={f.pending}
            className="font-semibold"
          >
            Send
          </Button>
        )
      }
    >
      {sent ? (
        <InviteSent sent={sent} />
      ) : (
        <FormErrors errors={f.errors}>
          <form {...f.formProps} className="flex flex-col gap-6 pb-6">
            <FieldCard>
              <FText
                name="name"
                label="Name"
                placeholder="Jordan Blake"
                autoComplete="off"
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
              />
              <FText
                name="email"
                label="Email"
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder="jordan@example.com"
                onChange={(e) =>
                  setHasEmail(e.currentTarget.value.trim() !== "")
                }
              />
              <FText
                name="phone"
                label="Mobile"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="(512) 555-0142"
                hint="Email or mobile — the invite link goes to whichever you enter."
                onChange={(e) =>
                  setHasPhone(e.currentTarget.value.trim() !== "")
                }
              />
            </FieldCard>
            <FieldCard header="Role">
              <FSelect
                name="role"
                label="Role"
                value={role}
                onChange={(e) => setRole(e.currentTarget.value)}
                options={roles.map((r) => ({ value: r.key, label: r.name }))}
              />
              {base === "admin" && (
                <p className="text-footnote text-label-2">
                  Admins can see money, change permissions and manage everyone.
                </p>
              )}
            </FieldCard>
            <section>
              <h2 className="px-4 pb-1.5 text-footnote uppercase text-label-2">
                Worker type
              </h2>
              <div className="rounded-card bg-card p-3">
                <SegmentedControl
                  label="Worker type"
                  name="workerType"
                  value={worker}
                  onChange={setWorker}
                  segments={[
                    { value: "1099", label: "1099 contractor" },
                    { value: "w2", label: "W-2 employee" },
                  ]}
                />
              </div>
              <p className="px-4 pt-1.5 text-footnote text-label-2">
                ⚖️ {WORKER_TYPE_NOTES[worker]}
              </p>
            </section>
            <ListSection header="Send the link by">
              <ToggleRow
                title="Email"
                subtitle={hasEmail ? "Sent right away" : "Enter an email above"}
                name="sendEmail"
                defaultChecked
                disabled={!hasEmail}
              />
              <ToggleRow
                title="Text message"
                subtitle={
                  hasPhone
                    ? "Added to your outbox to send from your phone"
                    : "Enter a mobile number above"
                }
                name="sendSms"
                defaultChecked={false}
                disabled={!hasPhone}
              />
            </ListSection>
            <p className="px-4 text-footnote text-label-2">
              The link works for 7 days. They set a password, and technicians
              accept the location-monitoring notice before they start.
            </p>
          </form>
        </FormErrors>
      )}
    </Sheet>
  );
}

function InviteSent({ sent }: { sent: SentInvite }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(sent.url);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Select the link and copy it by hand.");
    }
  }
  return (
    <div className="flex flex-col gap-6 pb-6">
      <div className="flex flex-col items-center gap-2 px-4 pt-4 text-center">
        <span
          aria-hidden
          className="flex size-14 items-center justify-center rounded-full bg-[var(--sys-green)] text-white enter-pop"
        >
          <Check size={30} strokeWidth={3} />
        </span>
        <h3 className="text-title3 font-semibold">{sent.name} is invited</h3>
        <p className="text-subhead text-label-2">
          {sent.emailed && "We emailed the link. "}
          {sent.texted && "A text is waiting in your outbox. "}
          The link expires{" "}
          {new Date(sent.expiresAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
          .
        </p>
      </div>
      <section>
        <h2 className="px-4 pb-1.5 text-footnote uppercase text-label-2">
          Invite link
        </h2>
        <div className="flex flex-col gap-3 rounded-card bg-card p-4">
          <code className="select-all break-all rounded-lg bg-fill-3 px-3 py-2 text-footnote">
            {sent.url}
          </code>
          <div className="flex flex-wrap gap-2">
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
              onClick={copy}
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
            {sent.smsHref && (
              <Button
                variant="gray"
                size="sm"
                href={sent.smsHref}
                transition="none"
                icon={<MessageSquare aria-hidden size={16} />}
              >
                Text it now
              </Button>
            )}
          </div>
        </div>
        <p className="px-4 pt-1.5 text-footnote text-label-2">
          Anyone with this link can join, so share it only with {sent.name}.
        </p>
      </section>
    </div>
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
