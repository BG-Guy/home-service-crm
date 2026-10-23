// Contract types for B8 settings (BUILD_PLAN §5.2, §6.8). Types only.
export type TagTarget =
  | "customer"
  | "job"
  | "lead"
  | "estimate"
  | "invoice"
  | "vehicle"
  | "tool";
export type TagBrief = { id: string; name: string; color: string };
export type CustomFieldEntity =
  | "customer"
  | "property"
  | "job"
  | "lead"
  | "vehicle"
  | "tool";
export type CustomFieldDef = {
  key: string;
  label: string;
  type:
    | "text"
    | "number"
    | "money"
    | "date"
    | "select"
    | "multiselect"
    | "boolean"
    | "photo";
  options?: string[];
  required: boolean;
  showOnInvoice: boolean;
};
export interface ServiceTypeRow {
  id: string;
  name: string;
  /** Job type it sits under (src/features/jobs/kinds.ts). */
  kind: "estimate" | "service" | "project";
  color: string | null;
  icon: string | null;
  aliases: string[];
  defaultDurationMin: number;
  defaultPriceCents: number | null;
  contractKind: "repair" | "improvement";
  checklistTemplateId: string | null;
  photosRequiredBefore: number;
  photosRequiredAfter: number;
  photosOnInvoice: boolean;
  requiresSignedEstimate: boolean;
  requiresOwnershipCheck: boolean;
  upsellCovered: boolean;
  warrantyDays: number;
  /** Retired (no maintenance reminders); always null since migration 0006. */
  maintenanceIntervalMonths: number | null;
  active: boolean;
}
export type ChecklistItemDef = {
  id: string;
  label: string;
  type: "check" | "text" | "number" | "photo" | "signature" | "select";
  required: boolean;
  options?: string[];
};

// §5.2 slot props
export type TagEditorProps = {
  entityType: TagTarget;
  entityId: string;
  initial?: TagBrief[];
};
export type CustomFieldsFieldsProps = {
  defs: CustomFieldDef[];
  values: Record<string, unknown>;
  namePrefix?: string; // default 'custom'
  jobId?: string; // for photo fields
};
