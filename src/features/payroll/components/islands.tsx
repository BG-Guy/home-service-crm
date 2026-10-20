"use client";

// Payroll client islands in their own chunks (next/dynamic, still server-rendered),
// so pages that mount payroll slots (job detail, Finish my day) don't carry them in
// their entry JS. The "Why $X?" sheet and the cash count form load with the slot.
import dynamic from "next/dynamic";

export const WhyAmount = dynamic(() =>
  import("./WhyAmount").then((m) => m.WhyAmount),
);

export const CashCountForm = dynamic(() =>
  import("./CashCountForm").then((m) => m.CashCountForm),
);

export const RemitCashButton = dynamic(() =>
  import("./PayActions").then((m) => m.RemitCashButton),
);

export const ConfirmRemittanceButtons = dynamic(() =>
  import("./PayActions").then((m) => m.ConfirmRemittanceButtons),
);
