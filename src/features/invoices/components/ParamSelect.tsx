"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select, type SelectOption } from "@/ui/components/Field";

// A native select that mirrors its value into one URL search param (list filters
// for /invoices and /estimates). Resets the pagination cursor.

export function ParamSelect({
  param,
  label,
  options,
  placeholder,
  className,
}: {
  param: string;
  label: string;
  options: readonly SelectOption[];
  placeholder: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <Select
      label={label}
      hideLabel
      options={options}
      placeholder={placeholder}
      value={sp.get(param) ?? ""}
      aria-busy={pending}
      className={className}
      onChange={(e) => {
        const next = new URLSearchParams(sp.toString());
        const v = e.currentTarget.value;
        if (v) next.set(param, v);
        else next.delete(param);
        next.delete("cursor");
        const qs = next.toString();
        start(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
      }}
    />
  );
}
