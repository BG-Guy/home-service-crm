// Contract types for B4 media (BUILD_PLAN §5.2, §6.4). Types only.
import type { EntityRef } from "@/lib/types";

export type MediaTag =
  | "before"
  | "during"
  | "after"
  | "problem"
  | "receipt"
  | "odometer"
  | "document"
  | "tool"
  | "signature"
  | "id_check"
  | "other";
export type MediaKind =
  | "photo"
  | "document"
  | "signature"
  | "receipt"
  | "avatar"
  | "logo"
  | "export"
  | "backup";

export interface MediaItem {
  id: string;
  kind: string;
  tag: MediaTag | null;
  caption: string | null;
  jobId: string | null;
  mime: string;
  width: number | null;
  height: number | null;
  createdAt: Date;
  capturedAt: Date | null;
  lat: number | null;
  lng: number | null;
  flags: string[];
  includeInInvoice: boolean;
  evidenceLocked: boolean;
  thumbUrl: string;
  url: string; // signed, 10 min
}

// §5.2 slot props
export type JobPhotosPanelProps = { jobId: string; canCapture?: boolean };
export type CameraCaptureButtonProps = {
  jobId?: string;
  entity?: EntityRef;
  kind?: MediaKind;
  defaultTag?: MediaTag;
  allowedTags?: MediaTag[];
  label?: string;
  multiple?: boolean;
  onQueued?: (m: { clientId: string }) => void;
};
export type PhotoPickerProps = {
  jobId: string;
  name: string;
  selected: string[];
  max?: number;
  tags?: MediaTag[];
};
export type InvoicePhotoGridProps = {
  invoiceId: string;
  variant: "invoice" | "receipt" | "portal";
  tokenId?: string;
};
export type PortalPhotoGalleryProps = { jobId: string; tokenId: string };

/** POST /api/uploads/presign request (F route; client: src/client/outbox.ts queueUpload). */
export interface PresignRequest {
  files: {
    name: string;
    mime: string;
    bytes: number;
    /** SHA-256 (hex) of the ORIGINAL file (the evidence hash). */
    sha256: string;
    /** SHA-256 (hex) of the exact bytes PUT to `upload_url` (checked by the store / at complete). */
    sha256Stored?: string;
    kind: MediaKind;
    tag?: MediaTag | null;
    clientId: string;
    /** Also upload a 320 px thumbnail / the untouched original. */
    withThumb?: boolean;
    withOriginal?: boolean;
    /** Mime of the untouched original when it differs from `mime` (e.g. HEIC vs WebP). */
    originalMime?: string;
  }[];
  entity?: EntityRef | null;
  jobId?: string | null;
}
export interface PresignedFile {
  clientId: string;
  mediaId: string;
  key: string;
  upload_url: string;
  headers: Record<string, string>;
  thumb_key?: string;
  thumb_upload_url?: string;
  original_key?: string;
  original_upload_url?: string;
  /** Headers the original's PUT must carry (Content-Type, checksum). */
  original_headers?: Record<string, string>;
  /** Opaque HMAC token; echo it to /api/uploads/complete. */
  upload_token: string;
}
export type PresignResponse = { files: PresignedFile[] };

/** POST /api/uploads/complete request (idempotent on clientId). */
export interface CompleteUploadRequest {
  mediaId: string;
  clientId: string;
  key: string;
  thumbKey?: string | null;
  originalKey?: string | null;
  uploadToken: string;
  kind: MediaKind;
  tag?: MediaTag | null;
  caption?: string | null;
  mime: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
  sha256Original: string;
  /** Echo of the presigned `sha256Stored` (bound in the upload token). */
  sha256Stored?: string | null;
  entity?: EntityRef | null;
  jobId?: string | null;
  geo?: { lat: number; lng: number; accuracyM?: number | null } | null;
  fileLastModified?: number | null;
  clientCapturedAt?: string | null;
}
export type CompleteUploadResponse = {
  mediaId: string;
  created: boolean;
  flags: string[];
  url: string;
  thumbUrl: string | null;
};
