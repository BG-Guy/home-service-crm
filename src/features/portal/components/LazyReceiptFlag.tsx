"use client";

import dynamic from "next/dynamic";
import type { ReceiptFlagButtonProps } from "@/features/payments/contracts";

/**
 * S28 "Wrong amount? / I didn't pay this" on the public receipt, loaded as its own
 * chunk after hydration. The slot module carries the Sheet and the staff payment
 * slots (~25 KB gz); this keeps them off the /i first load (the invoice view never
 * renders it). The placeholder keeps the button's height, so nothing shifts.
 */
export const LazyReceiptFlag = dynamic<ReceiptFlagButtonProps>(
  () =>
    import("@/features/payments/slots.client").then((m) => m.ReceiptFlagButton),
  {
    ssr: false,
    loading: () => <span aria-hidden className="block h-[34px]" />,
  },
);
