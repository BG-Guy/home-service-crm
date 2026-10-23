"use client";

import { LayoutGrid, Rows3 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";
import type { DocLayout } from "@/lib/doc-cards";
import { SegmentedControl } from "@/ui/components/SegmentedControl";

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Cards | List for a document list, remembered on this device in `cookie`. */
export function DocLayoutSwitch({
  cookie,
  value,
}: {
  cookie: string;
  value: DocLayout;
}) {
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
        // biome-ignore lint/suspicious/noDocumentCookie: a tiny UI preference, like the Appearance cookie
        document.cookie = `${cookie}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
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
