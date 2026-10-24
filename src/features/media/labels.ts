// Display labels for media tags and flags. Client-safe.
import type { MediaTag } from "./contracts";

export const TAG_LABEL: Record<MediaTag, string> = {
  before: "Before",
  during: "During",
  after: "After",
  problem: "Problem",
  goal: "Goal",
  receipt: "Receipt",
  odometer: "Odometer",
  document: "Document",
  tool: "Tool",
  signature: "Signature",
  id_check: "ID check",
  other: "Other",
};

export const FLAG_LABEL: Record<string, string> = {
  possibly_from_library: "Possibly from library",
  no_geo: "No location",
  far_from_site: "Far from the job site",
};

export const FLAG_HINT: Record<string, string> = {
  possibly_from_library:
    "The file is more than 24 hours older than its upload: it may not have been taken on this visit.",
  no_geo: "The phone didn't share a location when this photo was taken.",
  far_from_site: "The photo's location is far from the service address.",
};
