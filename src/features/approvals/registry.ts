import "server-only";
import { approvalKinds as jobs } from "@/features/jobs/approval-kinds";
import { approvalKinds as parts } from "@/features/parts/approval-kinds";
import { approvalKinds as payroll } from "@/features/payroll/approval-kinds";
import { approvalKinds as vehicles } from "@/features/vehicles/approval-kinds";
import type { FeatureFlag, FeatureFlags } from "@/lib/flags";
import type { ApprovalEntityType, ApprovalKindDef } from "./contracts";

// Approval kinds registry (BUILD_PLAN §6.10). Created by F, owned by B6.
// Each producer's kinds carry the feature flag of their module: a kind whose module
// is switched off is not listed, counted or decidable in bulk (QA T3-07).
const groups: {
  flag: FeatureFlag | null;
  kinds: readonly ApprovalKindDef[];
}[] = [
  { flag: "vehicles", kinds: vehicles },
  { flag: null, kinds: jobs },
  { flag: "parts", kinds: parts },
  { flag: "payroll", kinds: payroll },
];

export const approvalKindDefs: readonly ApprovalKindDef[] = groups.flatMap(
  (g) => g.kinds,
);

export function getApprovalKind(
  entityType: ApprovalEntityType,
): ApprovalKindDef | undefined {
  return approvalKindDefs.find((k) => k.entityTypes.includes(entityType));
}

/** Kinds whose module flag is on (kinds of always-on modules are always included). */
export function enabledApprovalKinds(
  flags: Partial<FeatureFlags>,
): ApprovalKindDef[] {
  return groups.flatMap((g) =>
    g.flag == null || flags[g.flag] ? [...g.kinds] : [],
  );
}
