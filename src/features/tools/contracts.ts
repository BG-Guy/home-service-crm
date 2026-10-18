// Contract types for B7 tools (BUILD_PLAN §5.2, §6.7). Types only — client-safe.
export type ToolAuditStatus = {
  nextDueOn: string | null;
  overdue: boolean;
  lastSubmittedAt: Date | null;
};
export type TodayToolCardProps = { userId: string };
export type ToolCustodyRowProps = { userId: string };

// ------------------------------------------------------------------ DTOs (internal UI)

export interface ToolFormValues {
  id?: string;
  name: string;
  category: string | null;
  brand: string | null;
  model: string | null;
  serial: string | null;
  purchaseDate: string | null;
  purchaseCostCents: number | null;
  replacementCostCents: number | null;
  owner: "company" | "tech_owned";
  ownerUserId: string | null;
  condition: "new" | "good" | "fair" | "poor";
  calibrationDueOn: string | null;
  maintenanceIntervalDays: number | null;
  maintenanceTask: string | null;
  lastMaintainedOn: string | null;
  notes: string | null;
  custom: Record<string, unknown>;
}

export interface PickTool {
  id: string;
  name: string;
  serial: string | null;
  assetTag: string | null;
  status: string;
  holderName: string | null;
  blocked: string | null;
}
