"use client";

import { Check, Copy, KeyRound, Server } from "lucide-react";
import { useState, useTransition } from "react";
import type { SECRET_KEYS } from "@/lib/secrets";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { ListRow } from "@/ui/components/List";
import { Sheet } from "@/ui/components/Sheet";
import { Pill } from "@/ui/components/StatusPill";
import { toast } from "@/ui/components/Toast";
import {
  sendTestMessageAction,
  setSecretAction,
  testProviderAction,
} from "../actions";
import { FieldCard, FormErrors, FText, useActionForm } from "./form";

export interface SecretStatus {
  key: (typeof SECRET_KEYS)[number];
  label: string;
  source: "env" | "db" | "none";
  last4: string | null;
  hint?: string;
}

/** One write-only credential: shows where it comes from and the last 4 characters. */
export function SecretRow({ s }: { s: SecretStatus }) {
  const [editing, setEditing] = useState(false);
  const [, start] = useTransition();
  const [confirm, confirmEl] = useConfirm();
  const detail =
    s.source === "none" ? (
      <Pill tone="gray" size="sm">
        Not set
      </Pill>
    ) : (
      <span className="flex items-center gap-2">
        <Pill tone={s.source === "env" ? "indigo" : "green"} size="sm">
          {s.source === "env" ? "Env" : "Saved"}
        </Pill>
        <span className="num text-label-2">•••• {s.last4}</span>
      </span>
    );
  async function clear() {
    const ok = await confirm({
      title: `Remove ${s.label}?`,
      message: "Anything that uses it stops working until you add it again.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const r = await setSecretAction({ key: s.key, value: "" });
      if (r.ok) toast.success(`${s.label} removed`);
      else toast.error(r.error);
    });
  }
  return (
    <>
      {confirmEl}
      <ListRow
        icon={
          s.source === "env" ? (
            <Server size={16} aria-hidden />
          ) : (
            <KeyRound size={16} aria-hidden />
          )
        }
        iconTone={s.source === "none" ? "gray" : "green"}
        iconStyle="tinted"
        title={s.label}
        subtitle={
          s.source === "env"
            ? `Set by the server (${s.key}) — it always wins`
            : (s.hint ?? s.key)
        }
        detail={detail}
        accessory={s.source === "env" ? "none" : "chevron"}
        onClick={s.source === "env" ? undefined : () => setEditing(true)}
      />
      {editing && (
        <SecretSheet
          s={s}
          onClear={s.source === "db" ? clear : undefined}
          onClosed={() => setEditing(false)}
        />
      )}
    </>
  );
}

function SecretSheet({
  s,
  onClear,
  onClosed,
}: {
  s: SecretStatus;
  onClear?: () => void;
  onClosed: () => void;
}) {
  const [open, setOpen] = useState(true);
  const f = useActionForm(setSecretAction, {
    success: `${s.label} saved`,
    onSuccess: () => setOpen(false),
  });
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      onClosed={onClosed}
      title={s.label}
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
          <input type="hidden" name="key" value={s.key} />
          <FieldCard footer="Stored encrypted. It can't be shown again — only the last 4 characters. Setting the environment variable instead overrides it.">
            <FText
              name="value"
              label={s.source === "db" ? "New value" : "Value"}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={s.last4 ? `•••• ${s.last4}` : s.key}
              required
              autoFocus
            />
          </FieldCard>
          {onClear && (
            <div className="px-4">
              <Button
                variant="plain"
                className="text-danger"
                onClick={() => {
                  setOpen(false);
                  onClear();
                }}
              >
                Remove saved value
              </Button>
            </div>
          )}
        </form>
      </FormErrors>
    </Sheet>
  );
}

/** "Send test email/push" and provider round-trip checks. */
export function TestRow({
  kind,
  label,
  subtitle,
}: {
  kind: "email" | "push" | "storage" | "geocode";
  label: string;
  subtitle?: string;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  function run() {
    start(async () => {
      if (kind === "email" || kind === "push") {
        const r = await sendTestMessageAction({ channel: kind });
        const text = r.ok
          ? kind === "email"
            ? `Queued to ${r.data?.to} (${r.data?.status})`
            : r.data?.status === "none"
              ? "No devices subscribed — enable push on your phone first"
              : "Sent to your devices"
          : r.error;
        setResult({ ok: r.ok, text });
        (r.ok ? toast.success : toast.error)(text);
      } else {
        const r = await testProviderAction({ kind });
        const text = r.ok ? (r.data?.message ?? "Works") : r.error;
        setResult({ ok: r.ok, text });
        (r.ok ? toast.success : toast.error)(text);
      }
    });
  }
  return (
    <ListRow
      title={<span className="text-accent-text">{label}</span>}
      subtitle={
        result ? (
          <span className={result.ok ? "text-label-2" : "text-danger"}>
            {result.text}
          </span>
        ) : (
          subtitle
        )
      }
      multiline
      detail={pending ? "Testing…" : undefined}
      onClick={pending ? undefined : run}
    />
  );
}

/** Read-only value with a copy button (VAPID public key, webhook URL). */
export function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="list-row flex min-h-11 items-center gap-3 px-4 py-2">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body">{label}</span>
        <code className="select-all truncate text-footnote text-label-2">
          {value}
        </code>
      </span>
      <Button
        variant="gray"
        size="sm"
        aria-label={`Copy ${label}`}
        icon={
          copied ? (
            <Check aria-hidden size={15} />
          ) : (
            <Copy aria-hidden size={15} />
          )
        }
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            toast.error("Couldn't copy");
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
