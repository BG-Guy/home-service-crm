// Automation conditions (SPEC M13): a tiny, safe evaluator over plain JSON. No eval,
// no functions, no regexes from user input. Isomorphic (used by the engine and the
// editor preview).
//
//   { all: [ { field: 'job.service_type_id', op: 'in', value: ['…'] },
//            { field: 'customer.tags', op: 'contains', value: 'vip' } ] }
//
// Groups: `all` (AND), `any` (OR), `not` (negation); groups nest. A bare leaf
// `{ field, op, value }` is also accepted at the top level. `{}` (or null) is true.
// Ops: eq, neq, in, nin, gt, gte, lt, lte, contains, exists, not_exists.

export const CONDITION_OPS = [
  "eq",
  "neq",
  "in",
  "nin",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "exists",
  "not_exists",
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export interface ConditionLeaf {
  field: string;
  op: ConditionOp;
  value?: unknown;
}
export interface ConditionGroup {
  all?: Condition[];
  any?: Condition[];
  not?: Condition;
}
export type Condition = ConditionLeaf | ConditionGroup;

export const OP_LABELS: Record<ConditionOp, string> = {
  eq: "is",
  neq: "is not",
  in: "is one of",
  nin: "is not one of",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  contains: "contains",
  exists: "is set",
  not_exists: "is empty",
};

const MAX_DEPTH = 8;
const UNSAFE = new Set(["__proto__", "prototype", "constructor"]);

/** Dotted-path lookup on plain data (never walks into prototypes). */
export function getField(ctx: unknown, path: string): unknown {
  let cur: unknown = ctx;
  for (const seg of path.split(".")) {
    if (UNSAFE.has(seg)) return undefined;
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur) && /^\d+$/.test(seg)) {
      cur = cur[Number(seg)];
      continue;
    }
    if (typeof cur !== "object" || !Object.hasOwn(cur as object, seg))
      return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function isEmpty(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    (typeof v === "string" && v.trim() === "") ||
    (Array.isArray(v) && v.length === 0)
  );
}

/** Numbers, numeric strings and ISO dates compare numerically; else null. */
function toComparable(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
      const t = Date.parse(v);
      return Number.isNaN(t) ? null : t;
    }
  }
  return null;
}

/** Loose equality: case-insensitive strings, numeric strings vs numbers, booleans vs "true". */
function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined)
    return (a ?? null) === (b ?? null);
  if (typeof a === "string" && typeof b === "string")
    return a.toLowerCase() === b.toLowerCase();
  if (typeof a === "boolean" || typeof b === "boolean")
    return String(a).toLowerCase() === String(b).toLowerCase();
  const na = toComparable(a);
  const nb = toComparable(b);
  return na !== null && nb !== null && na === nb;
}

function asList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.includes(","))
    return v.split(",").map((s) => s.trim());
  return [v];
}

export function evalLeaf(leaf: ConditionLeaf, ctx: unknown): boolean {
  const actual = getField(ctx, leaf.field);
  const expected = leaf.value;
  switch (leaf.op) {
    case "exists":
      return !isEmpty(actual);
    case "not_exists":
      return isEmpty(actual);
    case "eq":
      return looseEq(actual, expected);
    case "neq":
      return !looseEq(actual, expected);
    case "in":
      // An array field matches when any of its items is in the list.
      return Array.isArray(actual)
        ? actual.some((a) => asList(expected).some((e) => looseEq(a, e)))
        : asList(expected).some((e) => looseEq(actual, e));
    case "nin":
      return Array.isArray(actual)
        ? !actual.some((a) => asList(expected).some((e) => looseEq(a, e)))
        : !asList(expected).some((e) => looseEq(actual, e));
    case "contains":
      if (Array.isArray(actual))
        return actual.some((a) => looseEq(a, expected));
      if (typeof actual === "string" && expected !== undefined)
        return actual.toLowerCase().includes(String(expected).toLowerCase());
      return false;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = toComparable(actual);
      const b = toComparable(expected);
      if (a === null || b === null) return false;
      if (leaf.op === "gt") return a > b;
      if (leaf.op === "gte") return a >= b;
      if (leaf.op === "lt") return a < b;
      return a <= b;
    }
    default:
      return false; // unknown op → never matches (fail closed)
  }
}

function isLeaf(c: unknown): c is ConditionLeaf {
  return (
    !!c &&
    typeof c === "object" &&
    typeof (c as ConditionLeaf).field === "string" &&
    typeof (c as ConditionLeaf).op === "string"
  );
}

class Malformed extends Error {}

function evalNode(cond: unknown, ctx: unknown, depth: number): boolean {
  if (cond === null || cond === undefined) return true;
  if (typeof cond !== "object" || Array.isArray(cond)) throw new Malformed();
  if (depth > MAX_DEPTH) throw new Malformed();
  if (isLeaf(cond)) {
    if (!(CONDITION_OPS as readonly string[]).includes(cond.op))
      throw new Malformed();
    return evalLeaf(cond, ctx);
  }
  const g = cond as ConditionGroup & Record<string, unknown>;
  const keys = Object.keys(g).filter((k) => !k.startsWith("_"));
  if (keys.length === 0) return true;
  for (const k of keys)
    if (k !== "all" && k !== "any" && k !== "not") throw new Malformed();
  if (g.all !== undefined && !Array.isArray(g.all)) throw new Malformed();
  if (g.any !== undefined && !Array.isArray(g.any)) throw new Malformed();
  // Evaluate every branch (no short-circuit) so a malformed node anywhere is caught.
  const all = (g.all ?? []).map((c) => evalNode(c, ctx, depth + 1));
  const any = (g.any ?? []).map((c) => evalNode(c, ctx, depth + 1));
  const not = g.not !== undefined ? evalNode(g.not, ctx, depth + 1) : false;
  if (!all.every(Boolean)) return false;
  if (any.length > 0 && !any.some(Boolean)) return false;
  return !not;
}

/**
 * Evaluate a condition tree against a context object. Empty/missing → true.
 * Anything malformed anywhere in the tree (unknown key or operator, wrong types, too
 * deep) makes the WHOLE condition false — even under `not` — so a broken edit can
 * never mass-send.
 */
export function evaluateConditions(cond: unknown, ctx: unknown): boolean {
  try {
    return evalNode(cond, ctx, 0);
  } catch (e) {
    if (e instanceof Malformed) return false;
    throw e;
  }
}

/** Every field path referenced by a condition tree (editor + lazy context loading). */
export function conditionFields(
  cond: unknown,
  out = new Set<string>(),
): string[] {
  if (!cond || typeof cond !== "object") return [...out];
  if (isLeaf(cond)) {
    out.add(cond.field);
    return [...out];
  }
  const g = cond as ConditionGroup;
  for (const c of g.all ?? []) conditionFields(c, out);
  for (const c of g.any ?? []) conditionFields(c, out);
  if (g.not) conditionFields(g.not, out);
  return [...out];
}

/** Validate shape (editor save). Returns a list of human-readable problems. */
export function validateConditions(cond: unknown, depth = 0): string[] {
  if (cond === null || cond === undefined) return [];
  if (typeof cond !== "object" || Array.isArray(cond))
    return ["Conditions must be an object."];
  if (depth > MAX_DEPTH) return ["Conditions are nested too deeply."];
  if (isLeaf(cond)) {
    const errs: string[] = [];
    if (!/^[a-z_][\w.]*$/i.test(cond.field))
      errs.push(`Invalid field "${cond.field}".`);
    if (!(CONDITION_OPS as readonly string[]).includes(cond.op))
      errs.push(`Unknown operator "${cond.op}".`);
    return errs;
  }
  const errs: string[] = [];
  const g = cond as Record<string, unknown>;
  for (const k of Object.keys(g)) {
    if (k.startsWith("_")) continue;
    if (k === "all" || k === "any") {
      if (!Array.isArray(g[k])) errs.push(`"${k}" must be a list.`);
      else
        for (const c of g[k] as unknown[])
          errs.push(...validateConditions(c, depth + 1));
    } else if (k === "not") errs.push(...validateConditions(g[k], depth + 1));
    else errs.push(`Unknown key "${k}".`);
  }
  return errs;
}
