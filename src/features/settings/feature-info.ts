// Labels and descriptions for every feature flag (SPEC §5 table, §15.4) on
// Settings → Features. Client-safe data. A module that adds a flag should add a line
// here; unknown flags fall back to their manifest's name/description.

export interface FeatureInfo {
  label: string;
  description: string;
  icon: string;
  /** ⚖️ note shown under the switch. */
  legal?: string;
  /** Also needs this flag on. */
  requires?: string;
}

export const FEATURE_INFO: Record<string, FeatureInfo> = {
  leads: {
    label: "Leads & intake",
    description:
      "Lead inbox with response timers, website form, JSON API and marketplace hooks.",
    icon: "leads",
  },
  estimates: {
    label: "Estimates",
    description:
      "Good/better/best estimates with e-signature, follow-ups and change orders.",
    icon: "estimates",
  },
  deposits: {
    label: "Deposits",
    description:
      "Require deposits by rule (special orders, high-risk jobs) with card holds.",
    icon: "payments",
    legal: "Some states cap deposits on home-improvement work.",
  },
  chargeback_protection: {
    label: "Chargeback protection",
    description:
      "Job risk score, readiness score, start controls and one-tap evidence packs.",
    icon: "disputes",
  },
  photos: {
    label: "Job photos",
    description:
      "Geostamped job photos with tags, captions and photos on invoices.",
    icon: "photos",
  },
  before_after: {
    label: "Before & after photos",
    description:
      "Required before/after shots per service type and the compare slider.",
    icon: "camera",
    requires: "photos",
  },
  reviews: {
    label: "Review requests",
    description:
      "Ask happy customers for a Google review after the job, with click tracking.",
    icon: "reviews",
  },
  parts: {
    label: "Parts & receipts",
    description:
      "Parts on jobs, tech-paid receipts with approval and reimbursement.",
    icon: "parts",
  },
  inventory: {
    label: "Inventory",
    description:
      "Truck and warehouse stock, transfers, restock requests and counts.",
    icon: "inventory",
    requires: "parts",
  },
  payroll: {
    label: "Commission & payroll",
    description:
      "Commission plans, live tech earnings, settlements, payouts and NACHA files.",
    icon: "payroll",
  },
  vehicles: {
    label: "Vehicles",
    description:
      "Fleet, odometer and fuel logs, maintenance reminders, inspections and trips.",
    icon: "vehicles",
  },
  tools: {
    label: "Tools",
    description:
      "Company tools in tech custody, audits, incidents and maintenance.",
    icon: "tools",
    legal: "Tool deductions from pay stay off by default.",
  },
  map: {
    label: "Live map",
    description:
      "See techs on a map while they're clocked in; share a live ETA link with customers.",
    icon: "map",
    legal:
      "Techs must accept the location-monitoring notice; location is only shared on shift.",
  },
};
