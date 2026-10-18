// Nav badge counters for `invoices` (BUILD_PLAN §4, Appendix D). Owner: B3.
// `invoices.overdue`: open invoices past due with a balance (office/admin; neutral tone).
import type { BadgeKey } from "@/features/registry";
import type { SessionUser } from "@/lib/types";
import { countOverdueInvoices } from "./queries";

export const badges: Partial<
  Record<BadgeKey, (u: SessionUser) => Promise<number>>
> = {
  "invoices.overdue": countOverdueInvoices,
};
