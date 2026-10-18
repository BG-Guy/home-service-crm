// Contract types for B2 tasks (BUILD_PLAN §6.2). Types only.
export type TaskKind =
  | "lead_retry"
  | "warranty_claim"
  | "restock"
  | "callback_customer"
  | "refund_due"
  | "follow_up"
  | "custom";
