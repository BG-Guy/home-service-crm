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
// The invoice screen (Quote to Paid, Part I): one chunk for its small islands.
const actions = () => import("./InvoiceActions");
export const LazyInvoicePayBar = dynamic(() =>
  actions().then((m) => m.InvoicePayBar),
);
export const LazyInvoiceMoreActions = dynamic(() =>
  actions().then((m) => m.InvoiceMoreActions),
);
export const LazyChoosePhotosButton = dynamic(() =>
  actions().then((m) => m.ChoosePhotosButton),
);
export const LazySignOffButton = dynamic(() =>
  actions().then((m) => m.SignOffButton),
);
export const LazyPreviewButton = dynamic(() =>
  actions().then((m) => m.PreviewButton),
);
export const LazyReceiptButton = dynamic(() =>
  actions().then((m) => m.ReceiptButton),
);
