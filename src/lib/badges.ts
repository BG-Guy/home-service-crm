import "server-only";
import { badges as approvalsB } from "@/features/approvals/badges";
import { badges as authB } from "@/features/auth/badges";
import { badges as automationsB } from "@/features/automations/badges";
import { badges as customersB } from "@/features/customers/badges";
import { badges as dataB } from "@/features/data/badges";
import { badges as disputesB } from "@/features/disputes/badges";
import { badges as estimatesB } from "@/features/estimates/badges";
import { badges as insightsB } from "@/features/insights/badges";
import { badges as invoicesB } from "@/features/invoices/badges";
import { badges as jobsB } from "@/features/jobs/badges";
import { badges as leadsB } from "@/features/leads/badges";
import { badges as mapB } from "@/features/map/badges";
import { badges as mediaB } from "@/features/media/badges";
import { badges as messagingB } from "@/features/messaging/badges";
import { badges as notifyB } from "@/features/notify/badges";
import { badges as partsB } from "@/features/parts/badges";
import { badges as paymentsB } from "@/features/payments/badges";
import { badges as payrollB } from "@/features/payroll/badges";
import { badges as portalB } from "@/features/portal/badges";
import { badges as pricebookB } from "@/features/pricebook/badges";
import type { BadgeKey } from "@/features/registry";
import { badges as reviewsB } from "@/features/reviews/badges";
import { badges as settingsB } from "@/features/settings/badges";
import { badges as signaturesB } from "@/features/signatures/badges";
import { badges as tasksB } from "@/features/tasks/badges";
import { badges as teamB } from "@/features/team/badges";
import { badges as techB } from "@/features/tech/badges";
import { badges as timeB } from "@/features/time/badges";
import { badges as toolsB } from "@/features/tools/badges";
import { badges as vehiclesB } from "@/features/vehicles/badges";
import type { SessionUser } from "./types";

// Nav badge counts (BUILD_PLAN §4, Appendix D) aggregated from every module's badges.ts.
// A failing counter never breaks the shell: it reports 0.

type Counter = (u: SessionUser) => Promise<number>;
const SOURCES: readonly Partial<Record<BadgeKey, Counter>>[] = [
  authB,
  teamB,
  customersB,
  leadsB,
  jobsB,
  techB,
  estimatesB,
  invoicesB,
  paymentsB,
  disputesB,
  mediaB,
  messagingB,
  automationsB,
  reviewsB,
  partsB,
  payrollB,
  vehiclesB,
  toolsB,
  mapB,
  insightsB,
  settingsB,
  notifyB,
  portalB,
  dataB,
  tasksB,
  timeB,
  pricebookB,
  signaturesB,
  approvalsB,
];

export function badgeCounters(): Partial<Record<BadgeKey, Counter>> {
  return Object.assign({}, ...SOURCES);
}

/** Counts for the requested badge keys (default: all registered). */
export async function getBadgeCounts(
  user: SessionUser,
  keys?: readonly BadgeKey[],
): Promise<Partial<Record<BadgeKey, number>>> {
  const counters = badgeCounters();
  const wanted = keys ?? (Object.keys(counters) as BadgeKey[]);
  const entries = await Promise.all(
    wanted.map(async (k) => {
      const fn = counters[k];
      if (!fn) return [k, 0] as const;
      try {
        return [k, await fn(user)] as const;
      } catch (err) {
        console.error(`[badges] ${k} failed:`, err);
        return [k, 0] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}
