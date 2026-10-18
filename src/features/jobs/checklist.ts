// Pure checklist helpers (client-safe; no DB). Photo items are filed under the
// media tag their template asks for, so a "Before photo of the problem" counts as a
// before photo in Photos, readiness and the evidence pack (QA T1-05).
import type { MediaTag } from "@/features/media/contracts";

export type ChecklistPhotoTag =
  | "before"
  | "during"
  | "after"
  | "problem"
  | "id_check"
  | "document";

const EXPLICIT: readonly string[] = [
  "before",
  "during",
  "after",
  "problem",
  "id_check",
  "document",
];

/**
 * The media tag for a checklist photo item: an explicit `tag` on the template item
 * wins; otherwise it is read from the item's id and label.
 */
export function checklistPhotoTag(item: {
  id: string;
  label: string;
  tag?: unknown;
}): ChecklistPhotoTag {
  if (typeof item.tag === "string" && EXPLICIT.includes(item.tag))
    return item.tag as ChecklistPhotoTag;
  const id = item.id.replace(/^own:/, "");
  const text = `${id.replace(/[_-]+/g, " ")} ${item.label}`;
  if (/\b(?:id|license|licence|identification|identity)\b/i.test(text))
    return "id_check";
  if (
    /\b(?:proof|document|deed|lease|bill|registration|permit|paperwork)\b/i.test(
      text,
    )
  )
    return "document";
  if (/\bbefore\b/i.test(text)) return "before";
  if (/\b(?:after|finished|completed)\b/i.test(text)) return "after";
  if (/\b(?:problem|damage|damaged|broken|issue|defect)\b/i.test(text))
    return "problem";
  return "during";
}

/** Tags a checklist photo control offers: the item's own tag only. */
export function checklistPhotoTags(tag: ChecklistPhotoTag): MediaTag[] {
  return [tag];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A photo answer is a media id (or, until the upload lands, the upload's client id). */
export function isPhotoRef(answer: unknown): answer is string {
  return typeof answer === "string" && UUID.test(answer);
}
