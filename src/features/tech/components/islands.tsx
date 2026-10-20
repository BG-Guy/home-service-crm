"use client";

// Client islands of the tech Today, each in its own chunk (next/dynamic, still
// server-rendered). /today serves techs and the office from one route: loading
// these lazily keeps the tech app out of the office's JS and the ops board out of
// the tech's (docs/budget.md, /today). Shared by /today/finish and /time.
import dynamic from "next/dynamic";

export const ClockCard = dynamic(() =>
  import("./ClockCard").then((m) => m.ClockCard),
);

export const HeroActions = dynamic(() =>
  import("./HeroActions").then((m) => m.HeroActions),
);

export const TaskList = dynamic(() =>
  import("@/features/tasks/components/TaskList").then((m) => m.TaskList),
);

export const CallButton = dynamic(() =>
  import("@/features/customers/components/CallButton").then(
    (m) => m.CallButton,
  ),
);
