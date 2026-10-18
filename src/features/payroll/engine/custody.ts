// Cash custody (SPEC M16 "Cash custody"). Pure.
//   held = Σ cash + check payments collected by the tech
//        − Σ confirmed remittances
//        − Σ cash already netted in frozen settlements (−(cash_held + cash_remitted))
// Checks are never netted: netting can only consume collected cash.

export interface CustodyCollection {
  method: "cash" | "check";
  amountCents: number; // amount + tip
  at: Date;
}

export interface CustodyInput {
  collections: readonly CustodyCollection[];
  confirmedRemittancesCents: number;
  /** −Σ(cash_held + cash_remitted) in approved/paid/locked settlements (≥ 0). */
  nettedInSettlementsCents: number;
}

export interface CustodyResult {
  heldCents: number;
  cashCents: number;
  checksCents: number;
  /** Outstanding (not yet remitted or netted) cash and checks. */
  cashHeldCents: number;
  checksHeldCents: number;
  oldestAt: Date | null;
  /** Oldest outstanding CHECK (net-in-payout techs only ever hand in checks). */
  oldestCheckAt: Date | null;
}

export function custodyBalance(i: CustodyInput): CustodyResult {
  const cash = i.collections
    .filter((c) => c.method === "cash")
    .reduce((a, c) => a + c.amountCents, 0);
  const checks = i.collections
    .filter((c) => c.method === "check")
    .reduce((a, c) => a + c.amountCents, 0);
  const netted = Math.min(Math.max(0, i.nettedInSettlementsCents), cash);
  // Remittances settle checks first (they must always be handed in), then cash.
  const remitted = Math.max(0, i.confirmedRemittancesCents);
  const checksHeld = Math.max(0, checks - remitted);
  const remitToCash = Math.max(0, remitted - checks);
  const cashHeld = Math.max(0, cash - netted - remitToCash);
  const held = cashHeld + checksHeld;

  // Oldest outstanding item: consume collections oldest-first by what was settled.
  let oldestAt: Date | null = null;
  let oldestCheckAt: Date | null = null;
  if (held > 0) {
    const sorted = [...i.collections].sort(
      (a, b) => a.at.getTime() - b.at.getTime(),
    );
    let cashCovered = netted + remitToCash;
    let checksCovered = Math.min(remitted, checks);
    for (const c of sorted) {
      if (c.method === "cash") {
        if (cashCovered >= c.amountCents) {
          cashCovered -= c.amountCents;
          continue;
        }
        cashCovered = 0;
        oldestAt ??= c.at;
      } else {
        if (checksCovered >= c.amountCents) {
          checksCovered -= c.amountCents;
          continue;
        }
        checksCovered = 0;
        oldestAt ??= c.at;
        oldestCheckAt ??= c.at;
      }
      if (oldestCheckAt || checksHeld === 0) break;
    }
  }
  return {
    heldCents: held,
    cashCents: cash,
    checksCents: checks,
    cashHeldCents: cashHeld,
    checksHeldCents: checksHeld,
    oldestAt,
    oldestCheckAt,
  };
}

/**
 * Pay credit for a confirmed remittance (net_in_payout techs only): money handed in
 * first covers outstanding checks; the rest is cash that payroll already deducted
 * (cash_held) and is credited back as `cash_remitted`, capped by what was netted.
 */
export function remittanceCredit(i: {
  remittanceCents: number;
  checksCollectedCents: number;
  priorRemittedCents: number;
  priorCreditsCents: number;
  /** −Σ cash_held over all active (unreversed) entries. */
  cashNettedCents: number;
}): number {
  const checksCoveredBefore = Math.max(
    0,
    i.priorRemittedCents - i.priorCreditsCents,
  );
  const checksOutstanding = Math.max(
    0,
    i.checksCollectedCents - checksCoveredBefore,
  );
  const toCash = Math.max(0, i.remittanceCents - checksOutstanding);
  const creditable = Math.max(0, i.cashNettedCents - i.priorCreditsCents);
  return Math.min(toCash, creditable);
}

/** Over-limit check (§M16 alerts): held > max or the oldest item is older than remit_within_days. */
export function custodyAlert(
  r: Pick<CustodyResult, "heldCents" | "oldestAt">,
  limits: { maxCashHeldCents: number; remitWithinDays: number },
  now: Date,
): { over: boolean; reason: "amount" | "age" | null; oldestDays: number } {
  const oldestDays = r.oldestAt
    ? Math.floor((now.getTime() - r.oldestAt.getTime()) / 86_400_000)
    : 0;
  if (r.heldCents <= 0) return { over: false, reason: null, oldestDays: 0 };
  if (r.heldCents > limits.maxCashHeldCents)
    return { over: true, reason: "amount", oldestDays };
  if (oldestDays > limits.remitWithinDays)
    return { over: true, reason: "age", oldestDays };
  return { over: false, reason: null, oldestDays };
}
