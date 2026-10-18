import "server-only";
import { cronHooks as approvalsC } from "@/features/approvals/cron";
import { cronHooks as authC } from "@/features/auth/cron";
import { cronHooks as automationsC } from "@/features/automations/cron";
import { cronHooks as customersC } from "@/features/customers/cron";
import { cronHooks as dataC } from "@/features/data/cron";
import { cronHooks as disputesC } from "@/features/disputes/cron";
import { cronHooks as estimatesC } from "@/features/estimates/cron";
import { cronHooks as insightsC } from "@/features/insights/cron";
import { cronHooks as invoicesC } from "@/features/invoices/cron";
import { cronHooks as jobsC } from "@/features/jobs/cron";
import { cronHooks as leadsC } from "@/features/leads/cron";
import { cronHooks as mapC } from "@/features/map/cron";
import { cronHooks as mediaC } from "@/features/media/cron";
import { cronHooks as messagingC } from "@/features/messaging/cron";
import { cronHooks as notifyC } from "@/features/notify/cron";
import { cronHooks as partsC } from "@/features/parts/cron";
import { cronHooks as paymentsC } from "@/features/payments/cron";
import { cronHooks as payrollC } from "@/features/payroll/cron";
import { cronHooks as portalC } from "@/features/portal/cron";
import { cronHooks as pricebookC } from "@/features/pricebook/cron";
import { cronHooks as reviewsC } from "@/features/reviews/cron";
import { cronHooks as settingsC } from "@/features/settings/cron";
import { cronHooks as signaturesC } from "@/features/signatures/cron";
import { cronHooks as tasksC } from "@/features/tasks/cron";
import { cronHooks as teamC } from "@/features/team/cron";
import { cronHooks as techC } from "@/features/tech/cron";
import { cronHooks as timeC } from "@/features/time/cron";
import { cronHooks as toolsC } from "@/features/tools/cron";
import { cronHooks as vehiclesC } from "@/features/vehicles/cron";
import type { CronHook } from "./cron";
import { systemCronHooks } from "./system-cron";

// Aggregates F's system hooks + every module's cron.ts (BUILD_PLAN §4, §8.1).

const MODULE_HOOKS: readonly (readonly CronHook[])[] = [
  authC,
  teamC,
  customersC,
  leadsC,
  jobsC,
  techC,
  estimatesC,
  invoicesC,
  paymentsC,
  disputesC,
  mediaC,
  messagingC,
  automationsC,
  reviewsC,
  partsC,
  payrollC,
  vehiclesC,
  toolsC,
  mapC,
  insightsC,
  settingsC,
  notifyC,
  portalC,
  dataC,
  tasksC,
  timeC,
  pricebookC,
  signaturesC,
  approvalsC,
];

export function allCronHooks(): CronHook[] {
  const all = [...systemCronHooks, ...MODULE_HOOKS.flat()];
  const seen = new Set<string>();
  return all.filter((h) => {
    if (seen.has(h.key)) {
      console.warn(`[cron] duplicate hook key "${h.key}" ignored`);
      return false;
    }
    seen.add(h.key);
    return true;
  });
}
