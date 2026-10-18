// PDF renderer interface (SPEC §9.6) — FROZEN.
export interface PdfRenderer {
  id: "none" | "pdflib" | "chrome";
  render(i: {
    html?: string;
    url?: string;
    kind: "evidence_pack" | "invoice" | "statement";
    maxBytes?: number;
  }): Promise<Uint8Array>;
}
