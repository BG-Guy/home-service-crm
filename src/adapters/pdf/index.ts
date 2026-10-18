import "server-only";
import { ConflictError } from "@/lib/errors";
import type { PdfRenderer } from "./types";

// PDF adapter (SPEC §9.6). Default `none`: customer documents use browser print
// (window.print → Save as PDF). A server renderer (pdf-lib) is Later/opt-in (B4 steward).

export type { PdfRenderer } from "./types";

export const nonePdfRenderer: PdfRenderer = {
  id: "none",
  async render() {
    // Browser print (window.print → Save as PDF) is the MVP path; callers check
    // pdfEnabled() first. A pdf-lib/Chrome renderer is Later (SPEC §9.6).
    throw new ConflictError(
      "pdf_unavailable",
      "Server PDF rendering isn't set up: use Print → Save as PDF.",
    );
  },
};

export function pdfEnabled(): boolean {
  return getPdf().id !== "none";
}

export function getPdf(): PdfRenderer {
  return nonePdfRenderer;
}
