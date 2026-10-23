// The three job types every trade books under (leads-flow redesign, item 6):
// Free estimate, Service call, Project. The trade's own jobs (Lockout, Rekey, Car
// key…) are service_types rows of one of these kinds and keep their own rules
// (price, length, photos, checklist, warranty, ownership check).
//
// Client-safe: plain data and pure helpers, no imports at all (in particular not
// @/db/enums, which would pull zod into client bundles). The stored values are
// service_types.kind, validated server-side with `zJobKind` from @/db/enums; a test
// (tests/jobs/kinds.test.ts) keeps the two JOB_KINDS lists identical.

export const JOB_KINDS = ["estimate", "service", "project"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

type ContractKind = "repair" | "improvement";

export const KIND_LABEL: Record<JobKind, string> = {
  estimate: "Free estimate",
  service: "Service call",
  project: "Project",
};

/** One line under the label on the job type cards. */
export const KIND_HINT: Record<JobKind, string> = {
  estimate: "We look and quote",
  service: "Fix it on the visit",
  project: "Bigger work, half a day or more",
};

/** Icon names from src/ui/icons.ts (resolve with `iconFor`). */
export const KIND_ICON: Record<JobKind, string> = {
  estimate: "clipboard",
  service: "tools",
  project: "hammer",
};

/** iOS system color per kind (card accents, the generic rows' color). */
export const KIND_COLOR: Record<JobKind, string> = {
  estimate: "#8E8E93",
  service: "#007AFF",
  project: "#34C759",
};

export interface KindDefaults {
  /** Default length in minutes (new types of this kind; a booking with no trade job). */
  durationMin: number;
  /** ⚖️ Contract rules. `improvement` = home-improvement deposit caps and contract language. */
  contractKind: ContractKind;
  /** No deposit, or the deposit rules in Settings → Deposits. */
  deposit: "none" | "rules";
  /** The visit ends with an estimate (Free estimate). */
  endsWithEstimate: boolean;
}

export const KIND_DEFAULTS: Record<JobKind, KindDefaults> = {
  estimate: {
    durationMin: 45,
    contractKind: "repair",
    deposit: "none",
    endsWithEstimate: true,
  },
  service: {
    durationMin: 90,
    contractKind: "repair",
    deposit: "none",
    endsWithEstimate: false,
  },
  project: {
    durationMin: 240,
    contractKind: "improvement",
    deposit: "rules",
    endsWithEstimate: false,
  },
};

const KIND_SET = new Set<string>(JOB_KINDS);

export function isJobKind(v: unknown): v is JobKind {
  return typeof v === "string" && KIND_SET.has(v);
}

/** A stored kind, or "service" for anything unknown (the column default). */
export function kindOf(v: string | null | undefined): JobKind {
  return isJobKind(v) ? v : "service";
}

/** "45 min", "1 h 30 min", "4 h". */
export function durationLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

/** What `splitByKind` needs from a row (ServiceTypeOption and settings rows fit). */
export interface KindRow {
  id: string;
  name: string;
  kind: string;
}

export interface KindGroup<T extends KindRow> {
  kind: JobKind;
  /**
   * The kind's own row ("Free estimate" / "Service call" / "Project"): the card's
   * defaults, and what a booking uses when no trade job is picked. The row named
   * like the kind, else the first row of that kind; null when the kind has none.
   */
  primary: T | null;
  /** The trade's jobs under the card ("What's the job?" chips), in input order. */
  jobs: T[];
}

/**
 * Group rows (already sorted, e.g. by sort then name) under the three kinds, in
 * JOB_KINDS order. Every kind is present, even with no rows.
 */
export function splitByKind<T extends KindRow>(
  rows: readonly T[],
): KindGroup<T>[] {
  return JOB_KINDS.map((kind) => {
    const mine = rows.filter((r) => kindOf(r.kind) === kind);
    const label = KIND_LABEL[kind].toLowerCase();
    const primary =
      mine.find((r) => r.name.trim().toLowerCase() === label) ??
      mine[0] ??
      null;
    return {
      kind,
      primary,
      jobs: mine.filter((r) => r !== primary),
    };
  });
}

/** The kind's own row id (see `KindGroup.primary`), or null. */
export function primaryTypeId<T extends KindRow>(
  rows: readonly T[],
  kind: JobKind,
): string | null {
  return splitByKind(rows).find((g) => g.kind === kind)?.primary?.id ?? null;
}
