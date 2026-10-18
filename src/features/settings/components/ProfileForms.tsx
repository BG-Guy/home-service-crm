"use client";

import { LogOut } from "lucide-react";
import { useState, useTransition } from "react";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { ListRow } from "@/ui/components/List";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import {
  changeMyPasswordAction,
  setMyAvatarAction,
  signOutOtherDevicesAction,
  updateMyProfileAction,
} from "../actions";
import {
  FieldCard,
  FormErrors,
  FText,
  StickySave,
  useActionForm,
} from "./form";
import { ImageUpload } from "./ImageUpload";

/** Own name, email, phone and photo. */
export function MyProfileForm({
  name,
  email,
  phone,
  avatarUrl,
}: {
  name: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
}) {
  const f = useActionForm(updateMyProfileAction, { success: "Profile saved" });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-center">
        <ImageUpload
          kind="avatar"
          label="Photo"
          shape="circle"
          size={96}
          currentUrl={avatarUrl}
          hint="Customers see it on their job page"
          onSave={(mediaId) => setMyAvatarAction({ mediaId })}
        />
      </div>
      <FormErrors errors={f.errors}>
        <form {...f.formProps} className="flex flex-col">
          <FieldCard>
            <FText
              name="name"
              label="Name"
              defaultValue={name}
              required
              autoComplete="name"
            />
            <FText
              name="email"
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="email"
              defaultValue={email}
              required
            />
            <FText
              name="phone"
              label="Mobile"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              defaultValue={phone ?? ""}
            />
          </FieldCard>
          <StickySave pending={f.pending} label="Save profile" />
        </form>
      </FormErrors>
    </div>
  );
}

/** Password row → sheet with current/new/confirm. Other devices get signed out. */
export function PasswordRow() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ListRow
        title="Change password"
        accessory="chevron"
        onClick={() => setOpen(true)}
      />
      {open && <PasswordSheet onClosed={() => setOpen(false)} />}
    </>
  );
}

function PasswordSheet({ onClosed }: { onClosed: () => void }) {
  const [open, setOpen] = useState(true);
  const f = useActionForm(changeMyPasswordAction, {
    success: "Password changed",
    onSuccess: () => setOpen(false),
  });
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      onClosed={onClosed}
      title="Change password"
      detents={["content"]}
      leading={
        <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      }
      trailing={
        <Button
          variant="plain"
          size="sm"
          type="submit"
          form={f.id}
          loading={f.pending}
          className="font-semibold"
        >
          Save
        </Button>
      }
    >
      <FormErrors errors={f.errors}>
        <form {...f.formProps} className="flex flex-col gap-4 pb-6">
          <FieldCard footer="At least 10 characters. Your other devices will be signed out.">
            <FText
              name="currentPassword"
              label="Current password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
            />
            <FText
              name="newPassword"
              label="New password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
            />
            <FText
              name="confirmPassword"
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              required
            />
          </FieldCard>
        </form>
      </FormErrors>
    </Sheet>
  );
}

/** "Sign out other devices" with a confirm. */
export function SignOutOthersRow({ others }: { others: number }) {
  const [pending, start] = useTransition();
  const [confirm, confirmEl] = useConfirm();
  async function run() {
    const ok = await confirm({
      title: "Sign out other devices?",
      message:
        "Every other phone and browser has to sign in again. This one stays signed in.",
      confirmLabel: "Sign out",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const r = await signOutOtherDevicesAction({});
      if (r.ok)
        toast.success(
          r.data?.revoked
            ? `Signed out ${r.data.revoked} other session${r.data.revoked === 1 ? "" : "s"}`
            : "No other sessions",
        );
      else toast.error(r.error);
    });
  }
  return (
    <>
      {confirmEl}
      <ListRow
        icon={<LogOut size={17} aria-hidden />}
        iconTone="red"
        title="Sign out other devices"
        destructive
        detail={others ? `${others}` : undefined}
        disabled={pending || others === 0}
        onClick={run}
      />
    </>
  );
}
