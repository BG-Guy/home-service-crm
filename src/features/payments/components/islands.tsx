"use client";

// This module's client islands as split chunks (DESIGN.md §2): the server slots
// render these wrappers, so a page ships an island's code only when the slot
// actually renders it (Turbopack otherwise puts every client module reachable
// from the page into its entry, even inside tabs that don't render). Still SSR'd.
import dynamic from "next/dynamic";

export const LazyDepositActions = dynamic(() =>
  import("./PaymentActions").then((m) => m.DepositActions),
);
export const LazyMarkRefundPaidButton = dynamic(() =>
  import("./PaymentActions").then((m) => m.MarkRefundPaidButton),
);
export const LazyRefundButton = dynamic(() =>
  import("./PaymentActions").then((m) => m.RefundButton),
);
export const LazyRequestDepositButton = dynamic(() =>
  import("./PaymentActions").then((m) => m.RequestDepositButton),
);
export const LazyVerifyButton = dynamic(() =>
  import("./PaymentActions").then((m) => m.VerifyButton),
);
