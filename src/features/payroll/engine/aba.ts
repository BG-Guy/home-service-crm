// ABA routing number checksum (used client- and server-side on /pay/bank). Pure.
//   3·(d1 + d4 + d7) + 7·(d2 + d5 + d8) + (d3 + d6 + d9) ≡ 0 (mod 10)

export function isValidAba(routing: string): boolean {
  if (!/^\d{9}$/.test(routing)) return false;
  const d = routing.split("").map(Number) as number[];
  const sum =
    3 * ((d[0] ?? 0) + (d[3] ?? 0) + (d[6] ?? 0)) +
    7 * ((d[1] ?? 0) + (d[4] ?? 0) + (d[7] ?? 0)) +
    ((d[2] ?? 0) + (d[5] ?? 0) + (d[8] ?? 0));
  // The first two digits must be a valid Federal Reserve prefix (00–12, 21–32, 61–72, 80).
  const prefix = Number(routing.slice(0, 2));
  const prefixOk =
    (prefix >= 0 && prefix <= 12) ||
    (prefix >= 21 && prefix <= 32) ||
    (prefix >= 61 && prefix <= 72) ||
    prefix === 80;
  return prefixOk && sum % 10 === 0;
}

/** US bank account numbers: 4–17 digits. */
export function isValidAccountNumber(account: string): boolean {
  return /^\d{4,17}$/.test(account);
}

/** "••6789" style mask. */
export function last4(value: string): string {
  return value.slice(-4);
}
