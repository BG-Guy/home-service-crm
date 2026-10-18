"use client";

import { usePathname } from "next/navigation";
import {
  DetailLoading,
  ListLoading,
} from "@/app/(app)/_components/ListLoading";

// pay/loading.tsx wraps every /pay/* route. A navigation from outside /pay (More,
// the sidebar) shows that first boundary until the page streams in, so it picks
// the sub-route's own skeleton: /pay/settlements says "Payroll", not "Pay" (QA2
// NEW-6). Keep in step with the sub-routes' loading.tsx files.
export function PayLoading() {
  const rest = (usePathname() ?? "/pay").replace(/^\/pay\/?/, "");
  if (!rest) return <ListLoading title="Pay" />;
  if (rest === "settlements") return <ListLoading title="Payroll" />;
  if (rest.startsWith("settlements/"))
    return (
      <DetailLoading back={{ href: "/pay/settlements", label: "Payroll" }} />
    );
  if (rest === "statements")
    return (
      <DetailLoading title="Statements" back={{ href: "/pay", label: "Pay" }} />
    );
  if (rest.startsWith("statements/"))
    return (
      <DetailLoading
        title="Statement"
        back={{ href: "/pay/statements", label: "Statements" }}
      />
    );
  if (rest === "agreement")
    return (
      <DetailLoading
        title="Pay agreement"
        back={{ href: "/pay", label: "Pay" }}
      />
    );
  if (rest === "bank")
    return (
      <DetailLoading
        title="Direct deposit"
        back={{ href: "/pay", label: "Pay" }}
      />
    );
  return <DetailLoading />;
}
