import "server-only";
import { workers as approvalsW } from "@/features/approvals/workers";
import { workers as authW } from "@/features/auth/workers";
import { workers as automationsW } from "@/features/automations/workers";
import { workers as customersW } from "@/features/customers/workers";
import { workers as dataW } from "@/features/data/workers";
import { workers as disputesW } from "@/features/disputes/workers";
import { workers as estimatesW } from "@/features/estimates/workers";
import { workers as insightsW } from "@/features/insights/workers";
import { workers as invoicesW } from "@/features/invoices/workers";
import { workers as jobsW } from "@/features/jobs/workers";
import { workers as leadsW } from "@/features/leads/workers";
import { workers as mapW } from "@/features/map/workers";
import { workers as mediaW } from "@/features/media/workers";
import { workers as messagingW } from "@/features/messaging/workers";
import { workers as notifyW } from "@/features/notify/workers";
import { workers as partsW } from "@/features/parts/workers";
import { workers as paymentsW } from "@/features/payments/workers";
import { workers as payrollW } from "@/features/payroll/workers";
import { workers as portalW } from "@/features/portal/workers";
import { workers as pricebookW } from "@/features/pricebook/workers";
import { workers as reviewsW } from "@/features/reviews/workers";
import { workers as settingsW } from "@/features/settings/workers";
import { workers as signaturesW } from "@/features/signatures/workers";
import { workers as tasksW } from "@/features/tasks/workers";
import { workers as teamW } from "@/features/team/workers";
import { workers as techW } from "@/features/tech/workers";
import { workers as timeW } from "@/features/time/workers";
import { workers as toolsW } from "@/features/tools/workers";
import { workers as vehiclesW } from "@/features/vehicles/workers";
import type { JobQueueKind, Worker } from "./queue";

// job_queue kind → worker (BUILD_PLAN §8.2). F owns `ai` (policy layer, then aiHandlers);
// every other kind comes from the owning module's workers.ts.

const MODULE_WORKERS: readonly Partial<Record<JobQueueKind, Worker>>[] = [
  authW,
  teamW,
  customersW,
  leadsW,
  jobsW,
  techW,
  estimatesW,
  invoicesW,
  paymentsW,
  disputesW,
  mediaW,
  messagingW,
  automationsW,
  reviewsW,
  partsW,
  payrollW,
  vehiclesW,
  toolsW,
  mapW,
  insightsW,
  settingsW,
  notifyW,
  portalW,
  dataW,
  tasksW,
  timeW,
  pricebookW,
  signaturesW,
  approvalsW,
];

export async function getWorker(kind: string): Promise<Worker | undefined> {
  if (kind === "ai") {
    const { runAiJob } = await import("@/adapters/ai/queue");
    return runAiJob as unknown as Worker;
  }
  for (const w of MODULE_WORKERS) {
    const fn = w[kind as JobQueueKind];
    if (fn) return fn;
  }
  return undefined;
}
