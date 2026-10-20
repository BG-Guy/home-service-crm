// Recurrence labels without zod, so client editors don't pull the schema (~20 KB gz).
import type { Recurrence } from "./recurrence";

export const RECURRENCE_LABELS: Record<Recurrence["type"], string> = {
  once: "Once",
  daily: "Every day",
  weekly: "Weekly",
  monthly: "Monthly",
  every_n_days: "Every N days",
  every_n_months: "Every N months",
  every_n_miles: "Every N miles",
};
