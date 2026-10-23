"use client";

import { LayoutGrid, Rows3 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { type JobsLayout, writeJobsLayout } from "./jobs-layout";

/** Cards | List for /jobs, remembered on this device (the jobs-layout cookie). */
export function JobsLayoutSwitch({ value }: { value: JobsLayout }) {
  const router = useRouter();
  const [v, setV] = useState(value);
  const [, start] = useTransition();
  const icon = (node: ReactNode, label: string) => (
    <span className="flex justify-center" title={label}>
      {node}
      <span className="sr-only">{label}</span>
    </span>
  );
  return (
    <SegmentedControl
      className="w-[92px] shrink-0"
      label="Layout"
      value={v}
      onChange={(next) => {
        setV(next);
        writeJobsLayout(next);
        start(() => router.refresh());
      }}
      segments={[
        {
          value: "cards",
          label: icon(<LayoutGrid size={17} aria-hidden />, "Cards"),
        },
        { value: "list", label: icon(<Rows3 size={17} aria-hidden />, "List") },
      ]}
    />
  );
}
