"use client";

// Client islands of the office Today / ops board, each in its own chunk
// (next/dynamic, still server-rendered), so the tech's /today never ships them.
import dynamic from "next/dynamic";

export const SetupChecklistCard = dynamic(() =>
  import("./SetupChecklistCard").then((m) => m.SetupChecklistCard),
);

export const ReopenSetupButton = dynamic(() =>
  import("./ReopenSetupButton").then((m) => m.ReopenSetupButton),
);

export const AssignJobButton = dynamic(() =>
  import("@/features/jobs/components/AssignJobButton").then(
    (m) => m.AssignJobButton,
  ),
);

export const Elapsed = dynamic(() =>
  import("./Elapsed").then((m) => m.Elapsed),
);
