"use client";

// This module's client islands as split chunks (DESIGN.md §2): the server slots
// render these wrappers, so a page ships an island's code only when the slot
// actually renders it (Turbopack otherwise puts every client module reachable
// from the page into its entry, even inside tabs that don't render). Still SSR'd.
import dynamic from "next/dynamic";

export const LazyCreateInvoiceButton = dynamic(() =>
  import("./CreateInvoiceButton").then((m) => m.CreateInvoiceButton),
);
export const LazyDraftLines = dynamic(() =>
  import("./InvoiceControls").then((m) => m.DraftLines),
);
export const LazyInvoiceActionBar = dynamic(() =>
  import("./InvoiceControls").then((m) => m.InvoiceActionBar),
);
export const LazyInvoicePhotosForm = dynamic(() =>
  import("./InvoicePhotosForm").then((m) => m.InvoicePhotosForm),
);
