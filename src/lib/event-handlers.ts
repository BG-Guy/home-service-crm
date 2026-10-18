import "server-only";
import {
  handlers as approvalsH,
  ignores as approvalsI,
} from "@/features/approvals/events";
import { handlers as authH, ignores as authI } from "@/features/auth/events";
import {
  handlers as automationsH,
  ignores as automationsI,
} from "@/features/automations/events";
import {
  handlers as customersH,
  ignores as customersI,
} from "@/features/customers/events";
import { handlers as dataH, ignores as dataI } from "@/features/data/events";
import {
  handlers as disputesH,
  ignores as disputesI,
} from "@/features/disputes/events";
import {
  handlers as estimatesH,
  ignores as estimatesI,
} from "@/features/estimates/events";
import {
  handlers as insightsH,
  ignores as insightsI,
} from "@/features/insights/events";
import {
  handlers as invoicesH,
  ignores as invoicesI,
} from "@/features/invoices/events";
import { handlers as jobsH, ignores as jobsI } from "@/features/jobs/events";
import { handlers as leadsH, ignores as leadsI } from "@/features/leads/events";
import { handlers as mapH, ignores as mapI } from "@/features/map/events";
import { handlers as mediaH, ignores as mediaI } from "@/features/media/events";
import {
  handlers as messagingH,
  ignores as messagingI,
} from "@/features/messaging/events";
import {
  handlers as notifyH,
  ignores as notifyI,
} from "@/features/notify/events";
import { handlers as partsH, ignores as partsI } from "@/features/parts/events";
import {
  handlers as paymentsH,
  ignores as paymentsI,
} from "@/features/payments/events";
import {
  handlers as payrollH,
  ignores as payrollI,
} from "@/features/payroll/events";
import {
  handlers as portalH,
  ignores as portalI,
} from "@/features/portal/events";
import {
  handlers as pricebookH,
  ignores as pricebookI,
} from "@/features/pricebook/events";
import {
  handlers as reviewsH,
  ignores as reviewsI,
} from "@/features/reviews/events";
import {
  handlers as settingsH,
  ignores as settingsI,
} from "@/features/settings/events";
import {
  handlers as signaturesH,
  ignores as signaturesI,
} from "@/features/signatures/events";
import { handlers as tasksH, ignores as tasksI } from "@/features/tasks/events";
import { handlers as teamH, ignores as teamI } from "@/features/team/events";
import { handlers as techH, ignores as techI } from "@/features/tech/events";
import { handlers as timeH, ignores as timeI } from "@/features/time/events";
import { handlers as toolsH, ignores as toolsI } from "@/features/tools/events";
import {
  handlers as vehiclesH,
  ignores as vehiclesI,
} from "@/features/vehicles/events";
import type { HandlerReg, IgnoreReg } from "./events";

// Aggregates every module's events.ts (BUILD_PLAN §4). Loaded lazily by processEvents()
// to keep lib/events.ts free of import cycles.

const ALL_HANDLERS: readonly (readonly HandlerReg[])[] = [
  authH,
  teamH,
  customersH,
  leadsH,
  jobsH,
  techH,
  estimatesH,
  invoicesH,
  paymentsH,
  disputesH,
  mediaH,
  messagingH,
  automationsH,
  reviewsH,
  partsH,
  payrollH,
  vehiclesH,
  toolsH,
  mapH,
  insightsH,
  settingsH,
  notifyH,
  portalH,
  dataH,
  tasksH,
  timeH,
  pricebookH,
  signaturesH,
  approvalsH,
];
const ALL_IGNORES: readonly (readonly IgnoreReg[])[] = [
  authI,
  teamI,
  customersI,
  leadsI,
  jobsI,
  techI,
  estimatesI,
  invoicesI,
  paymentsI,
  disputesI,
  mediaI,
  messagingI,
  automationsI,
  reviewsI,
  partsI,
  payrollI,
  vehiclesI,
  toolsI,
  mapI,
  insightsI,
  settingsI,
  notifyI,
  portalI,
  dataI,
  tasksI,
  timeI,
  pricebookI,
  signaturesI,
  approvalsI,
];

export function moduleHandlers(): HandlerReg[] {
  const out = ALL_HANDLERS.flat();
  const seen = new Set<string>();
  for (const h of out) {
    if (seen.has(h.name))
      console.warn(
        `[events] duplicate handler name "${h.name}" (later one wins)`,
      );
    seen.add(h.name);
  }
  return out;
}

export function moduleIgnores(): IgnoreReg[] {
  return ALL_IGNORES.flat();
}
