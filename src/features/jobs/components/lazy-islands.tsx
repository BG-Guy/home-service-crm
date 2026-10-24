"use client";

// The job page's client islands as split chunks (DESIGN.md §2 speed rules).
// Each still server-renders (no flash, no layout shift), but its code is no
// longer part of the page's entry: it loads only when that tab or state
// actually renders it. Slots from other modules are only wrapped here, never
// changed (their owners keep their props and behavior).
import dynamic from "next/dynamic";

/** The overview checklist (photo answers, sign-off items). */
export const LazyChecklist = dynamic(() =>
  import("./ChecklistClient").then((m) => m.ChecklistClient),
);

/** Notes list + composer (job and customer overviews). */
export const LazyNotes = dynamic(() =>
  import("./NotesClient").then((m) => m.NotesClient),
);

/** Status dock (tech / assignee views only). */
export const LazyActionBar = dynamic(() =>
  import("./ActionBar").then((m) => m.ActionBar),
);

/** Money card: "Present to Sophia" and "Get customer sign-off" (one island). */
export const LazyMoneyCardButton = dynamic(() =>
  import("./MoneyCardButtons").then((m) => m.MoneyCardButton),
);

/** Payments S-slot: Collect / Collect deposit. */
export const LazyCollectPaymentButton = dynamic(() =>
  import("@/features/payments/slots.client").then(
    (m) => m.CollectPaymentButton,
  ),
);

/** Parts S-slot: add or order a part (in-progress / on-hold dock tiles). */
export const LazyAddPartButton = dynamic(() =>
  import("@/features/parts/slots.client").then((m) => m.AddPartButton),
);

/** Reviews S-slot: request a review (completed jobs). */
export const LazyRequestReviewButton = dynamic(() =>
  import("@/features/reviews/slots.client").then((m) => m.RequestReviewButton),
);

/** Settings S-slot: the tag editor (office overview). */
export const LazyTagEditor = dynamic(() =>
  import("@/features/settings/slots.client").then((m) => m.TagEditor),
);
