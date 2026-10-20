"use client";

// The invite sheet, loaded on first open by InviteButton (Invites.tsx).

import { useState } from "react";
import {
  FieldCard,
  FormErrors,
  FSelect,
  FText,
  useActionForm,
} from "@/features/settings/components/form";
import { Button } from "@/ui/components/Button";
import { ListSection } from "@/ui/components/List";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { ToggleRow } from "@/ui/components/Toggle";
import { inviteUserAction } from "../actions";
import { WORKER_TYPE_NOTES } from "../rules";
import { InviteSent, type SentInvite } from "./InviteSent";
import type { RoleOption } from "./Invites";

export default function InviteSheet({
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
              <h2 className="px-4 pb-2 text-subhead font-semibold text-label-2">
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
