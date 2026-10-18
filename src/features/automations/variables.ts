// Template variable catalog (SPEC §7.4) for the editor's variable picker. Client-safe
// data. The renderer itself lives in src/lib/template.ts; values come from
// buildTemplateContext (context.ts).

export interface VariableGroup {
  key: string;
  label: string;
  /** Only meaningful for staff templates. */
  staff?: boolean;
  vars: { path: string; label: string }[];
}

export const VARIABLE_GROUPS: readonly VariableGroup[] = [
  {
    key: "company",
    label: "Company",
    vars: [
      { path: "company.name", label: "Name" },
      { path: "company.phone", label: "Phone" },
      { path: "company.email", label: "Email" },
      { path: "company.website", label: "Website" },
      { path: "company.license", label: "License #" },
      { path: "company.lead_response_minutes", label: "Response time (min)" },
      { path: "company.address_short", label: "Address" },
    ],
  },
  {
    key: "customer",
    label: "Customer",
    vars: [
      { path: "customer.first_name", label: "First name" },
      { path: "customer.last_name", label: "Last name" },
      { path: "customer.display_name", label: "Full name" },
      { path: "customer.company_name", label: "Company" },
    ],
  },
  {
    key: "lead",
    label: "Lead",
    vars: [
      { path: "lead.service", label: "Service asked for" },
      { path: "lead.preferred_date", label: "Preferred date" },
      { path: "lead.source", label: "Source" },
    ],
  },
  {
    key: "job",
    label: "Job",
    vars: [
      { path: "job.number", label: "Job #" },
      { path: "job.service", label: "Service" },
      { path: "job.date_short", label: "Date (Tue Oct 14)" },
      { path: "job.date_long", label: "Date (long)" },
      { path: "job.window", label: "Arrival window" },
      { path: "job.time", label: "Start time" },
      { path: "job.address_short", label: "Address" },
      { path: "job.address_full", label: "Full address" },
      { path: "job.link", label: "Job page link" },
      { path: "job.service_fee_line", label: "Service-fee line" },
      { path: "job.status_label", label: "Status" },
    ],
  },
  {
    key: "tech",
    label: "Technician",
    vars: [
      { path: "tech.first_name", label: "First name" },
      { path: "tech.photo_url", label: "Photo (email)" },
      { path: "tech.license", label: "License #" },
      { path: "eta_minutes", label: "ETA minutes" },
      { path: "eta_time", label: "ETA time" },
      { path: "tracking.link", label: "Live tracking link" },
    ],
  },
  {
    key: "estimate",
    label: "Estimate",
    vars: [
      { path: "estimate.number", label: "Estimate #" },
      { path: "estimate.total", label: "Total" },
      { path: "estimate.link", label: "Estimate link" },
      { path: "estimate.expires_date", label: "Expires" },
    ],
  },
  {
    key: "invoice",
    label: "Invoice",
    vars: [
      { path: "invoice.number", label: "Invoice #" },
      { path: "invoice.total", label: "Total" },
      { path: "invoice.balance", label: "Balance" },
      { path: "invoice.due_date", label: "Due date" },
      { path: "invoice.link", label: "Invoice link" },
      { path: "invoice.pay_link", label: "Pay link" },
    ],
  },
  {
    key: "payment",
    label: "Payment",
    vars: [
      { path: "payment.amount", label: "Amount" },
      { path: "payment.method", label: "Method" },
      { path: "payment.date", label: "Date" },
      { path: "payment.collected_by_line", label: "“to Mike” line" },
      { path: "receipt.link", label: "Receipt link" },
      { path: "deposit.amount", label: "Deposit amount" },
      { path: "deposit.link", label: "Deposit link" },
      { path: "deposit.policy_short", label: "Deposit policy" },
    ],
  },
  {
    key: "review",
    label: "Review & booking",
    vars: [
      { path: "review.link", label: "Review link (/r/…)" },
      { path: "booking.link", label: "Booking form link" },
      { path: "last_job.service", label: "Last service" },
      { path: "last_job.date_short", label: "Last visit date" },
      { path: "months_since_last_job", label: "Months since last visit" },
    ],
  },
  {
    key: "staff",
    label: "Team only",
    staff: true,
    vars: [
      { path: "user.first_name", label: "Recipient first name" },
      { path: "lead.sla_minutes", label: "Lead wait (min)" },
      { path: "count", label: "Count" },
      { path: "amount", label: "Amount" },
      { path: "vehicle.nickname", label: "Vehicle" },
      { path: "task", label: "Task" },
      { path: "days", label: "Days" },
      { path: "entity.url", label: "Link in the app" },
    ],
  },
];

/** Flat list of every known path (unknown-variable warnings). */
export const KNOWN_VARIABLES: ReadonlySet<string> = new Set(
  VARIABLE_GROUPS.flatMap((g) => g.vars.map((v) => v.path)),
);

/** Audiences offered by the automation editor (plus perm:/role:/user: custom). */
export const AUDIENCE_OPTIONS: { value: string; label: string }[] = [
  { value: "customer", label: "Customer" },
  { value: "assigned_tech", label: "Assigned tech (primary)" },
  { value: "assigned_techs", label: "All assigned techs" },
  { value: "added_techs", label: "Newly assigned techs" },
  { value: "removed_techs", label: "Removed techs" },
  { value: "event_techs", label: "Techs on the job (at the time)" },
  { value: "subject_user", label: "The team member it's about" },
  { value: "creator", label: "Creator" },
  { value: "vehicle_assignee", label: "Vehicle driver" },
  { value: "office", label: "Office" },
  { value: "admins", label: "Admins" },
];

export const CHANNEL_OPTIONS: { value: string; label: string }[] = [
  { value: "customer_preferred", label: "Customer's preferred" },
  { value: "sms", label: "Text" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "push", label: "Push" },
  { value: "in_app", label: "In-app" },
];
