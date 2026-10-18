// Contract types for B7 vehicles (BUILD_PLAN §5.2, §6.7). Types only — importable
// from client code. DTOs crossing to the client use ISO strings, not Dates.
import type { ApprovalHint } from "./rules";

export type { ApprovalHint };

export type AssignedVehicle = {
  id: string;
  nickname: string;
  odometer: number | null;
  ownership: "company_owned" | "leased" | "tech_owned";
};
export type FleetSummary = {
  costPerMileCents: number | null;
  fuelSpendCents: number;
  miles: number;
  overdueReminders: number;
  dueSoon: number;
  openIssues: number;
};
export type TodayVehicleCardProps = { userId: string };
export type OdometerCaptureButtonProps = {
  vehicleId: string;
  source: "clock" | "manual";
  label?: string;
  onRecorded?: (odometerReadingId: string) => void;
  /** Optional: shown in the sheet header (defaults to "Vehicle"). */
  vehicleName?: string;
  /** Optional: last approved reading, for the "lower than last" hint. */
  lastOdometer?: number | null;
  /** Optional: button variant / full width (host layout). */
  variant?: "filled" | "tinted" | "gray" | "plain";
  fullWidth?: boolean;
  /**
   * Optional (additive): what saving does for this viewer, from
   * `approvalHint()` in `vehicles/rules.ts`. Only changes the sheet copy.
   */
  approvalHint?: ApprovalHint;
};
export type EndOdometerSectionProps = { userId: string };
export type AssignedVehicleRowProps = { userId: string };
export type FleetSummaryCardProps = {
  from: string;
  to: string /* YYYY-MM-DD company TZ */;
};

// ------------------------------------------------------------------ DTOs (internal UI)

export type VehicleOwnership = AssignedVehicle["ownership"];
export type VehicleStatus = "active" | "in_shop" | "retired";
export type ReminderStatus = "ok" | "due_soon" | "overdue";
export type LogApprovalStatus = "pending" | "approved" | "rejected";

export interface VehicleListItem {
  id: string;
  nickname: string;
  description: string;
  plate: string | null;
  status: VehicleStatus;
  ownership: VehicleOwnership;
  assignee: { id: string; name: string } | null;
  odometer: number | null;
  overdue: number;
  dueSoon: number;
  openIssues: number;
  pendingLogs: number;
  photoUrl: string | null;
}

export interface VehicleFormValues {
  id?: string;
  nickname: string;
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  engine: string | null;
  fuelType: string | null;
  gvwrLbs: number | null;
  usdotNumber: string | null;
  plate: string | null;
  plateState: string | null;
  ownership: VehicleOwnership;
  assignedUserId: string | null;
  tankGal: number | null;
  status: VehicleStatus;
  custom: Record<string, unknown>;
}

export interface DecodedVin {
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  engine: string | null;
  fuel: string | null;
  gvwrLb: number | null;
  bodyClass: string | null;
}

export interface ReminderRuleDto {
  id: string;
  task: string;
  label: string;
  intervalMiles: number | null;
  intervalDays: number | null;
  dueSoonMiles: number | null;
  dueSoonDays: number | null;
  lastDoneOn: string | null;
  lastDoneOdometer: number | null;
  nextDueOn: string | null;
  nextDueMiles: number | null;
  status: ReminderStatus;
  active: boolean;
}

export interface InspectionItemDef {
  key: string;
  label: string;
}

export type InspectionResult = Record<
  string,
  { ok: boolean; note?: string | null }
>;
