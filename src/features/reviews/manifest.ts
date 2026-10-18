// Module manifest: `reviews` (SPEC §15.1). Owner: B5.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "reviews",
  name: "Review requests",
  description:
    "Sentiment-neutral review requests, the /r/ rating page and stats.",
  owner: "B5",
  grants,
  flags,
  settingsShape,
  settingsPage: "/settings/reviews",
  nav,
  emits: [
    "review.requested",
    "review.clicked",
    "review.rated",
    "review.received_logged",
  ],
});
