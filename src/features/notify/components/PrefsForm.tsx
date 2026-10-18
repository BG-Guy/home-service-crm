"use client";

import { useRef, useState } from "react";
import { ListRow, ListSection } from "@/ui/components/List";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { toast } from "@/ui/components/Toast";
import { saveNotificationPrefs } from "../actions";
import {
  NOTIFICATION_TYPES,
  type NotificationPref,
  type NotificationTypeDef,
} from "../catalog";

/**
 * S35: per notification type — Push (default), Email, or Off (bell only). Saves as
 * you change it. Critical types note the email fallback when push isn't available.
 */
export function PrefsForm({
  userId,
  initial,
}: {
  userId: string;
  initial: Record<string, NotificationPref>;
}) {
  const [prefs, setPrefs] = useState<Record<string, NotificationPref>>(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groups = new Map<string, NotificationTypeDef[]>();
  for (const t of NOTIFICATION_TYPES) {
    const list = groups.get(t.group) ?? [];
    list.push(t);
    groups.set(t.group, list);
  }

  const change = (key: string, v: NotificationPref) => {
    const next = { ...prefs, [key]: v };
    setPrefs(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const res = await saveNotificationPrefs({ userId, prefs: next });
      if (!res.ok)
        toast({ title: "Couldn't save", message: res.error, tone: "error" });
    }, 500);
  };

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {[...groups.entries()].map(([group, types]) => (
        <ListSection
          key={group}
          header={group}
          footer={
            group === "Leads & jobs"
              ? "In-app notifications always appear in the bell. Off only stops push and email."
              : undefined
          }
        >
          {types.map((t) => (
            <ListRow
              key={t.key}
              title={t.label}
              subtitle={
                t.critical ? "Emails you if push isn't set up" : undefined
              }
              multiline
              detail={
                <SegmentedControl
                  label={`${t.label} delivery`}
                  value={prefs[t.key] ?? "push"}
                  segments={[
                    { value: "push", label: "Push" },
                    { value: "email", label: "Email" },
                    { value: "off", label: "Off" },
                  ]}
                  onChange={(v) => change(t.key, v)}
                  className="w-[180px]"
                />
              }
            />
          ))}
        </ListSection>
      ))}
    </div>
  );
}
