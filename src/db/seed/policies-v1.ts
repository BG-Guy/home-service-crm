import type { PolicyKind } from "@/db/enums";

// Version-1 policy texts seeded by the base seed (SPEC §15.3). Plain-language
// starting points for the owner to review in Settings — not legal advice. "{company}"
// is replaced with the company name when rendered.

export const POLICIES_V1: Record<PolicyKind, { title: string; body: string }> =
  {
    cancellation: {
      title: "Cancellation policy",
      body: "You can cancel or reschedule free of charge up to 24 hours before your arrival window. Late cancellations and missed appointments (no one home, no access) may be charged the cancellation fee shown on your booking confirmation.",
    },
    refund: {
      title: "Refund policy",
      body: "If something isn't right, tell us within 30 days and we'll make it right. Approved refunds go back to the original payment method; card refunds usually appear within 5–10 business days. Special-order parts are non-refundable once ordered.",
    },
    warranty: {
      title: "Workmanship warranty",
      body: "{company} warrants its workmanship for the number of days shown on your invoice from the date of service. Parts carry the manufacturer's warranty. The warranty doesn't cover misuse, damage by others, or work done by anyone else.",
    },
    deposit: {
      title: "Deposit terms",
      body: "A deposit reserves your appointment and any special-order parts. It is applied to your final invoice. Deposits are refundable until 24 hours before your arrival window, except the cost of special-order parts once they have been ordered.",
    },
    esign_consent: {
      title: "Consent to electronic records and signatures",
      body: "By checking this box and signing, you agree to receive documents (estimates, invoices, receipts and agreements) electronically and that your electronic signature has the same effect as a handwritten one. You can request a paper copy at any time.",
    },
    sms_terms: {
      title: "SMS terms",
      body: "{company} sends text messages about your requests, appointments, invoices and receipts. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. We never share or sell your mobile number or opt-in data with third parties for marketing.",
    },
    privacy: {
      title: "Privacy policy",
      body: "We collect the contact and service information you give us to schedule and perform work, bill you and stay in touch about your service. We don't sell your personal information. Mobile opt-in data and consent are never shared with third parties. Contact us to access or delete your information.",
    },
    comp_agreement: {
      title: "Compensation agreement",
      body: "This agreement describes how your pay is calculated under your assigned compensation plan, including the commission rate, deductions before the split, tips, reimbursements, cash handling and settlement timing. Each statement shows the calculation for every job. A new version requires a new signature.",
    },
    tool_agreement: {
      title: "Company tool agreement",
      body: "Company tools assigned to you remain company property. Keep them secured, report loss, theft or damage right away, and return them when asked or when your work ends. Deductions for lost tools apply only where permitted by law and only if enabled by the company.",
    },
    monitoring_notice: {
      title: "Location monitoring notice",
      body: "While you are clocked in and the app is open, {company} records your device location about once a minute and when you change a job's status, to dispatch work and show customers your arrival. Location is never collected while you are off shift. Locations are kept only as long as needed for these purposes.",
    },
    cooling_off: {
      title: "Notice of right to cancel (3 business days)",
      body: "You may cancel this transaction, without any penalty or obligation, within three business days from the above date. If you cancel, any payments made will be returned within ten business days. To cancel, notify us in writing by the end of the third business day.",
    },
    card_on_file: {
      title: "Card on file authorization",
      body: "I authorize {company} to save my card and charge it for the balance of this job or for the no-show/late-cancellation fee described in the cancellation policy. I can revoke this authorization in writing at any time before the charge.",
    },
    direct_deposit_auth: {
      title: "Direct deposit authorization",
      body: "I authorize {company} to deposit my pay to the bank account I entered and, if necessary, to correct erroneous deposits. This authorization stays in effect until I change or cancel it. Changing bank details pauses payouts briefly while the change is verified.",
    },
  };
