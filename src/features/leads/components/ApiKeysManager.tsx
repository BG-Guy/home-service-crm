"use client";

import { KeyRound, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { useConfirm } from "@/ui/components/Alert";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { TextField } from "@/ui/components/Field";
import { ListRow, ListSection } from "@/ui/components/List";
import { Sheet } from "@/ui/components/Sheet";
import { SwipeActions } from "@/ui/components/SwipeActions";
import { toast } from "@/ui/components/Toast";
import { createApiKey, revokeApiKey } from "../actions";
import { CopyBlock } from "./CopyBlock";

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  createdByName: string | null;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

/** Server API keys: create (shown once), list, revoke. */
export function ApiKeysManager({ keys }: { keys: ApiKeyRow[] }) {
  const [open, setOpen] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const [confirm, confirmEl] = useConfirm();
  const active = keys.filter((k) => !k.revokedAt);
  const revoked = keys.filter((k) => k.revokedAt);

  const create = (fd: FormData) =>
    start(async () => {
      fd.append("scopes[]", "leads:write");
      const r = await createApiKey(fd);
      if (!r.ok || !r.data) {
        setErrors(r.ok ? {} : (r.fieldErrors ?? {}));
        return void toast.error(r.ok ? "Couldn't create" : r.error);
      }
      setIssued(r.data.key);
    });

  const revoke = async (k: ApiKeyRow) => {
    const ok = await confirm({
      title: `Revoke “${k.name}”?`,
      message:
        "Anything using this key stops sending leads immediately. This can't be undone.",
      confirmLabel: "Revoke",
      destructive: true,
    });
    if (!ok) return;
    const r = await revokeApiKey({ id: k.id });
    if (r.ok) toast.success("Key revoked");
    else toast.error(r.error);
  };

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {confirmEl}
      <ListSection
        header="Active keys"
        trailing={
          <Button
            variant="plain"
            size="sm"
            icon={<Plus size={16} aria-hidden />}
            onClick={() => setOpen(true)}
          >
            New key
          </Button>
        }
        footer="Send as “Authorization: Bearer sk_live_…” to POST /api/v1/leads. Add a “source” field (name or id) to attribute leads; otherwise the default source is used."
      >
        {active.length === 0 && (
          <ListRow title={<span className="text-label-2">No keys yet</span>} />
        )}
        {active.map((k) => (
          <SwipeActions
            key={k.id}
            trailing={[
              { label: "Revoke", destructive: true, onAction: () => revoke(k) },
            ]}
          >
            <ListRow
              icon={<KeyRound size={17} />}
              iconTone="indigo"
              title={k.name}
              subtitle={`${k.prefix}… · ${k.scopes.join(", ")} · ${k.lastUsedAt ? `used ${fmt(k.lastUsedAt)}` : "never used"}`}
              detail={fmt(k.createdAt)}
              accessory={
                <Button
                  variant="plain"
                  size="sm"
                  className="text-[var(--sys-red)]"
                  onClick={() => revoke(k)}
                >
                  Revoke
                </Button>
              }
            />
          </SwipeActions>
        ))}
      </ListSection>
      {revoked.length > 0 && (
        <ListSection header="Revoked">
          {revoked.map((k) => (
            <ListRow
              key={k.id}
              title={
                <span className="text-label-2 line-through">{k.name}</span>
              }
              subtitle={`${k.prefix}… · revoked ${fmt(k.revokedAt as string)}`}
            />
          ))}
        </ListSection>
      )}
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={issued ? "Copy your key" : "New API key"}
        detents={["content", "large"]}
        onClosed={() => {
          setIssued(null);
          setErrors({});
        }}
        leading={
          <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
            {issued ? "Done" : "Cancel"}
          </Button>
        }
        trailing={
          issued ? undefined : (
            <Button
              variant="plain"
              size="sm"
              className="font-semibold"
              type="submit"
              form="new-api-key"
              loading={pending}
            >
              Create
            </Button>
          )
        }
      >
        {issued ? (
          <div className="flex flex-col gap-3 pb-6">
            <Banner tone="warning" title="Shown only once">
              Store it in your integration now. We keep only a fingerprint of
              it.
            </Banner>
            <CopyBlock label="Secret key" value={issued} />
          </div>
        ) : (
          <form
            id="new-api-key"
            onSubmit={(e) => {
              e.preventDefault();
              create(new FormData(e.currentTarget));
            }}
            className="flex flex-col gap-3 pb-6"
          >
            <TextField
              label="Name"
              name="name"
              placeholder="Zapier, website backend…"
              required
              error={errors.name}
            />
            <p className="px-1 text-footnote text-label-2">
              Scope: create leads (leads:write).
            </p>
          </form>
        )}
      </Sheet>
    </div>
  );
}
