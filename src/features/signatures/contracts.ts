// Contract types for B3 signatures (BUILD_PLAN §5.2, §6.3). Types only.
import type { ActionResult, Geo } from "@/lib/types";

export type SignatureDocType =
  | "estimate"
  | "change_order"
  | "completion"
  | "deposit_terms"
  | "ownership"
  | "comp_agreement"
  | "tool_agreement"
  | "monitoring_notice"
  | "card_on_file"
  | "cooling_off_waiver"
  | "statement_ack";

export interface CaptureSignatureInput {
  docType: SignatureDocType;
  docId: string;
  docSnapshot: unknown;
  policyVersionIds?: string[];
  signerName: string;
  signerKind: "customer" | "user";
  signerUserId?: string | null;
  customerId?: string | null;
  signatureMediaId?: string | null;
  channel: "in_person" | "remote_link" | "verbal";
  esignConsent: boolean;
  consentText?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  geo?: Geo | null;
  deviceTs?: Date | null;
  tokenId?: string | null;
}

export interface SignatureBrief {
  id: string;
  docType: SignatureDocType;
  signerName: string;
  channel: string;
  signedAt: Date;
  docSha256: string;
}

export type SignatureSubmit = {
  signerName: string;
  esignConsent: true;
  signatureMediaId: string;
  geo?: Geo | null;
  deviceTs: string;
  clientId: string;
};
export type SignatureSheetProps = {
  title: string;
  docType: SignatureDocType;
  consentText: string;
  summaryLines?: string[];
  signerNameDefault?: string;
  publicToken?: string; // remote signing: upload via /api/uploads/public/presign
  action: (
    input: SignatureSubmit,
  ) => Promise<ActionResult<{ signatureId: string }>>;
  triggerLabel?: string;
  doneHref?: string;
};
