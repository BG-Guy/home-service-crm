// Compliance-profile contract warnings (SPEC M07 ⚖️). Shown on home-improvement
// estimates (service type contract_kind 'improvement') when
// settings.compliance.contract_templates is on. Informational, never blocking:
// the office confirms the contract meets the state's rules. Not legal advice.

export interface ComplianceNote {
  title: string;
  body: string;
}

const STATE_NOTES: Record<string, ComplianceNote> = {
  CT: {
    title: "Connecticut home-improvement contract",
    body: "CT requires a written contract with your HIC registration number, start and completion dates, the full price, the 3-day cancellation notice and both signatures before work starts.",
  },
  CA: {
    title: "California home-improvement contract",
    body: "CA caps the down payment at 10% of the price or $1,000, whichever is less, and requires your CSLB license number, the HIC notices and a 3-day right to cancel in the contract.",
  },
  NY: {
    title: "New York home-improvement contract",
    body: "NY requires a written contract with start/completion dates, a payment schedule, the 3-day cancellation notice and where deposits are held (escrow or bond).",
  },
  MA: {
    title: "Massachusetts home-improvement contract",
    body: "MA limits the deposit to one-third of the price (except special orders) and requires your HIC registration number and the 3-day cancellation notice.",
  },
};

export function complianceNotes(a: {
  contractKind: string | null;
  state: string | null;
  enabled: boolean;
}): ComplianceNote[] {
  if (!a.enabled || a.contractKind !== "improvement") return [];
  const st = (a.state ?? "").trim().toUpperCase();
  const specific = STATE_NOTES[st];
  return [
    specific ?? {
      title: "Home-improvement contract",
      body: "Improvement work often needs a written contract with your license or registration number, the price, dates and a cancellation notice. Check your state's rules before work starts.",
    },
  ];
}
