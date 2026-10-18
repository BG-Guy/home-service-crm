// Template syntax lint (QA T3-14): the template editor's live preview and the save
// action both run it. Pure (no DB); server-side only because it reads the built-in
// catalog to learn every variable the renderer fills.
//   - a broken tag ("{{job.link", "{{ job link }}", a stray "}}") blocks saving: it
//     would reach a customer as literal braces;
//   - a review request without {{review.link}} blocks saving: the ask is useless;
//   - an unknown variable is a warning (it renders empty, or its |fallback).
import { extractVariables } from "@/lib/template";
import { builtinTemplates } from "./builtin";
import { KNOWN_VARIABLES } from "./variables";

/** Filled by buildTemplateContext / the sender but not offered in the picker. */
const EXTRA_VARIABLES = [
  "company.emergency_line",
  "company.review_link",
  "job.cancel_fee_line",
  "job.window_end_time",
  "lead.name",
  "change_order.link",
  "deposit.capture_before",
  "dispute.amount",
  "dispute.due_date",
  "refund.amount",
  "refund.date",
  "review.callback_line",
  "task_body",
  "tool.name",
  "user.name",
  "agenda.first_address",
  "agenda.first_time",
  "document",
  "period",
  "skipped",
];

let known: ReadonlySet<string> | null = null;

/** Every variable path the renderer can fill (picker ∪ built-in templates ∪ extras). */
export function knownTemplateVariables(): ReadonlySet<string> {
  if (!known)
    known = new Set([
      ...KNOWN_VARIABLES,
      ...EXTRA_VARIABLES,
      ...builtinTemplates.flatMap((t) =>
        extractVariables(`${t.subject ?? ""}\n${t.body}`),
      ),
    ]);
  return known;
}

/** Same grammar as src/lib/template.ts (path, optional :filter, optional |fallback). */
const TAG =
  /\{\{\s*([A-Za-z_][\w.]*)\s*(?::\s*([a-z_][a-z0-9_]*)\s*)?(?:\|([^}]*))?\}\}/g;
const FILTERS = new Set([
  "money",
  "money0",
  "date",
  "date_long",
  "time",
  "upper",
  "lower",
  "first",
]);

/** Template keys whose whole point is a link the customer must get. */
const REQUIRED_VARIABLE: Record<string, string> = {
  "review.request": "review.link",
  "review.reminder": "review.link",
};

export interface TemplateSyntaxLint {
  /** Blocking: broken tags, missing required link. */
  errors: string[];
  /** Non-blocking: unknown variables / filters. */
  warnings: string[];
  unknown: string[];
}

function snippet(text: string, at: number): string {
  return text
    .slice(Math.max(0, at - 12), at + 18)
    .replace(/\s+/g, " ")
    .trim();
}

export function lintTemplateSyntax(
  key: string,
  text: string,
  vars: ReadonlySet<string> = knownTemplateVariables(),
): TemplateSyntaxLint {
  const errors: string[] = [];
  const warnings: string[] = [];
  const unknown = new Set<string>();
  const badFilters = new Set<string>();
  const paths = new Set<string>();
  for (const m of text.matchAll(TAG)) {
    const path = m[1] as string;
    paths.add(path);
    if (!vars.has(path)) unknown.add(path);
    if (m[2] && !FILTERS.has(m[2])) badFilters.add(m[2]);
  }
  // Whatever is left after removing well-formed tags must not contain braces pairs.
  const rest = text.replace(TAG, (t) => " ".repeat(t.length));
  const open = rest.indexOf("{{");
  const close = rest.indexOf("}}");
  if (open >= 0 || close >= 0) {
    const at = open >= 0 ? open : close;
    errors.push(
      `A {{…}} variable is broken near "${snippet(text, at)}". Use {{name}} with two braces on each side.`,
    );
  }
  const need = REQUIRED_VARIABLE[key];
  if (need && !paths.has(need))
    errors.push(
      `This message must include {{${need}}}, or the customer gets nothing to tap.`,
    );
  if (unknown.size)
    warnings.push(
      `Unknown ${unknown.size === 1 ? "variable" : "variables"} ${[...unknown]
        .map((u) => `{{${u}}}`)
        .join(
          ", ",
        )}: ${unknown.size === 1 ? "it" : "they"} will be left empty.`,
    );
  if (badFilters.size)
    warnings.push(
      `Unknown format ${[...badFilters].map((f) => `:${f}`).join(", ")}: the value shows unformatted.`,
    );
  return { errors, warnings, unknown: [...unknown] };
}
