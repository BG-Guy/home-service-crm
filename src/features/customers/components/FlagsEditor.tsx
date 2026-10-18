"use client";

import { useOptimistic, useTransition } from "react";
import { ListSection } from "@/ui/components/List";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import { setCustomerFlagsAction } from "../actions";
import type { CustomerFlags } from "../contracts";

const ROWS: { key: keyof CustomerFlags; title: string; subtitle: string }[] = [
  {
    key: "vip",
    title: "VIP",
    subtitle: "Priority scheduling and white-glove service",
  },
  {
    key: "prepayRequired",
    title: "Prepay required",
    subtitle: "Collect a deposit before booking",
  },
  {
    key: "doNotService",
    title: "Do not service",
    subtitle: "Warn anyone who books or dispatches",
  },
  {
    key: "disputeHistory",
    title: "Dispute history",
    subtitle: "Set automatically when a chargeback opens",
  },
  {
    key: "taxExempt",
    title: "Tax exempt",
    subtitle: "Keep the certificate on file",
  },
  {
    key: "doNotText",
    title: "Do not text",
    subtitle: "No SMS, even transactional",
  },
  {
    key: "doNotContact",
    title: "Do not contact",
    subtitle: "No calls, texts or emails",
  },
];

/** Customer flags (customers.flags_manage). Optimistic toggles; each change is audited. */
export function FlagsEditor({
  customerId,
  flags,
}: {
  customerId: string;
  flags: CustomerFlags;
}) {
  const [optimistic, setOptimistic] = useOptimistic(
    flags,
    (cur, p: Partial<CustomerFlags>) => ({ ...cur, ...p }),
  );
  const [, start] = useTransition();
  return (
    <ListSection header="Flags" footer="Changes are logged in the audit trail.">
      {ROWS.map((r) => (
        <ToggleRow
          key={r.key}
          title={r.title}
          subtitle={r.subtitle}
          checked={optimistic[r.key]}
          onChange={(e) => {
            const value = e.currentTarget.checked;
            start(async () => {
              setOptimistic({ [r.key]: value });
              const res = await setCustomerFlagsAction({
                id: customerId,
                flag: r.key,
                value,
              });
              if (!res.ok) toast.error(res.error);
            });
          }}
        />
      ))}
    </ListSection>
  );
}
