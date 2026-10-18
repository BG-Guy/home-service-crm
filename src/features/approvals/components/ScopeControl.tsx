"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { SegmentedControl } from "@/ui/components/SegmentedControl";

type Scope = "pending" | "done";

/** Waiting / Decided switch for /approvals (a real 44 px control, QA T4-22). */
export function ScopeControl({
  scope,
  pendingHref,
  doneHref,
}: {
  scope: Scope;
  pendingHref: string;
  doneHref: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState<Scope>(scope);
  const [, start] = useTransition();
  return (
    <SegmentedControl
      label="Show"
      size="lg"
      className="w-full max-w-xs"
      value={value}
      onChange={(v) => {
        setValue(v);
        start(() => router.replace(v === "done" ? doneHref : pendingHref));
      }}
      segments={[
        { value: "pending", label: "Waiting" },
        { value: "done", label: "Decided (14 days)" },
      ]}
    />
  );
}
