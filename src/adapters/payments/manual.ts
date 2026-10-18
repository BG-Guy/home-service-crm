import "server-only";
import type { PaymentProvider } from "./types";

// Manual driver (SPEC §9.2): cash/check/Zelle/Venmo recorded by staff. No links, no
// money movement; a refund is recorded only, with a note to pay back by the original
// method. Snapshots come from the form input (B4).
export const manualProvider: PaymentProvider = {
  id: "manual",
  caps: {
    links: false,
    authHold: false,
    cardPresent: "none",
    savedCards: false,
    ach: false,
    disputesApi: false,
    tips: true,
  },
  async refund(ref, amountCents, _reason, idem) {
    return {
      ref: `manual_refund_${idem || ref}`,
      status: "succeeded",
      amountCents,
    };
  },
};
