// Commission split helper shared by the assign sheet and /jobs/new (client-safe).

type Pick = { userId: string; role: "primary" | "helper" };

/** Primary gets `primaryPct`; helpers share the rest (last absorbs rounding). */
export function splitFor(
  picks: Pick[],
  primaryPct: number,
): { userId: string; role: "primary" | "helper"; splitBps: number }[] {
  if (picks.length === 0) return [];
  if (picks.length === 1)
    return [
      { userId: picks[0]?.userId ?? "", role: "primary", splitBps: 10000 },
    ];
  const primary = picks.find((p) => p.role === "primary") ?? picks[0];
  const helpers = picks.filter((p) => p.userId !== primary?.userId);
  const pBps = Math.round(primaryPct * 100);
  const rest = 10000 - pBps;
  const each = Math.floor(rest / helpers.length);
  return [
    { userId: primary?.userId ?? "", role: "primary", splitBps: pBps },
    ...helpers.map((h, i) => ({
      userId: h.userId,
      role: "helper" as const,
      splitBps:
        i === helpers.length - 1 ? rest - each * (helpers.length - 1) : each,
    })),
  ];
}
