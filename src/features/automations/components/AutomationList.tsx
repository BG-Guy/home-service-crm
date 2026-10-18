"use client";

import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { TextField } from "@/ui/components/Field";
import { ListSection } from "@/ui/components/List";
import { Sheet } from "@/ui/components/Sheet";
import { Pill } from "@/ui/components/StatusPill";
import { toast } from "@/ui/components/Toast";
import { Toggle } from "@/ui/components/Toggle";
import { createAutomation, setAutomationEnabled } from "../actions";
import type { AutomationListItem } from "../queries";

function Row({ a }: { a: AutomationListItem }) {
  const [on, setOn] = useState(a.enabled);
  return (
    <div className="list-row flex min-h-11 items-center gap-3 pr-4">
      <Link
        href={`/settings/automations/${a.key}`}
        className="flex min-w-0 flex-1 items-center gap-2 py-2.5 pl-4"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2 text-body text-label">
            <span className="truncate">{a.name}</span>
            {!a.builtin && (
              <Pill tone="purple" size="sm">
                Custom
              </Pill>
            )}
          </span>
          <span className="truncate text-subhead text-label-2">
            {a.trigger} · {a.summary}
          </span>
        </span>
        <ChevronRight aria-hidden size={16} className="shrink-0 text-label-3" />
      </Link>
      <Toggle
        label={`${a.name} on/off`}
        checked={on}
        onChange={async (e) => {
          const next = e.currentTarget.checked;
          setOn(next);
          const res = await setAutomationEnabled({ id: a.id, enabled: next });
          if (!res.ok) {
            setOn(!next);
            toast({
              title: "Couldn't change it",
              message: res.error,
              tone: "error",
            });
          } else toast({ title: next ? `${a.name} on` : `${a.name} off` });
        }}
      />
    </div>
  );
}

/** Settings → Automations: toggles per automation, grouped by audience. */
export function AutomationList({ items }: { items: AutomationListItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const customer = items.filter((a) => a.audience === "customer");
  const team = items.filter((a) => a.audience === "team");
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <div className="flex justify-end">
        <Button
          variant="tinted"
          size="sm"
          icon={<Plus aria-hidden size={16} />}
          onClick={() => setOpen(true)}
        >
          New automation
        </Button>
      </div>
      <ListSection
        header={`Customer messages (${customer.length})`}
        footer="Every customer message still checks consent, quiet hours and daily limits before it goes out."
      >
        {customer.map((a) => (
          <Row key={a.id} a={a} />
        ))}
      </ListSection>
      <ListSection header={`Team alerts (${team.length})`}>
        {team.map((a) => (
          <Row key={a.id} a={a} />
        ))}
      </ListSection>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="New automation"
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
            className="font-semibold"
            disabled={!name.trim() || busy}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const res = await createAutomation({ name });
              setBusy(false);
              if (res.ok && res.data)
                router.push(`/settings/automations/${res.data.key}`);
              else if (!res.ok)
                toast({
                  title: "Couldn't create it",
                  message: res.error,
                  tone: "error",
                });
            }}
          >
            Create
          </Button>
        }
      >
        <div className="flex flex-col gap-3 pb-6">
          <TextField
            label="Name"
            value={name}
            autoFocus
            placeholder="Thank-you text after big jobs"
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <p className="px-1 text-footnote text-label-2">
            It starts turned off so you can set the trigger, timing and message
            first.
          </p>
        </div>
      </Sheet>
    </div>
  );
}
