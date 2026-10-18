// Plain constants shared by the settings fragment (zod defaults) and client forms,
// kept out of settings.ts so client bundles don't pull zod in.

/** Placeholder pay-by text until the business writes its own (warned in settings). */
export const DEFAULT_MANUAL_INSTRUCTIONS =
  "Pay by Zelle or Venmo to our business account, or by check payable to our business. Include your job number.";
