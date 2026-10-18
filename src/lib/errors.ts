// Domain errors (BUILD_PLAN §2). Thrown from libs and api.ts functions; `action()`
// maps them to `{ ok: false, … }`. Isomorphic (no server imports).

export class AppError extends Error {
  /** Stable machine code, e.g. 'forbidden', 'not_found', 'overpayment'. */
  readonly code: string;
  /** Safe to show to the end user. */
  readonly userMessage: string;
  constructor(code: string, userMessage: string, message?: string) {
    super(message ?? userMessage);
    this.name = new.target.name;
    this.code = code;
    this.userMessage = userMessage;
  }
}

/** A stubbed contract whose producer hasn't implemented it yet. */
export class NotImplementedError extends AppError {
  constructor(what: string, owner?: string) {
    super(
      "not_implemented",
      "This feature isn't available yet.",
      `Not implemented: ${what}${owner ? ` (owner: ${owner})` : ""}`,
    );
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Please sign in.") {
    super("unauthorized", message);
  }
}

/**
 * Next's `forbidden()` digest (`next/dist/client/components/http-access-fallback`).
 * A ForbiddenError that escapes a page render shows `(app)/forbidden.tsx` with a 403
 * and no server error log; one that escapes a route handler becomes a bare 403.
 * `action()` and `jsonError()` still map it to `{ ok: false }` / a JSON 403 first.
 */
export const FORBIDDEN_DIGEST = "NEXT_HTTP_ERROR_FALLBACK;403";

export class ForbiddenError extends AppError {
  readonly perm?: string;
  readonly digest = FORBIDDEN_DIGEST;
  constructor(
    message = "You don't have permission to do that.",
    perm?: string,
  ) {
    super("forbidden", message, perm ? `${message} (${perm})` : message);
    this.perm = perm;
  }
}

export class NotFoundError extends AppError {
  constructor(what = "Record") {
    super("not_found", `${what} not found.`);
  }
}

/** Business-rule conflict, e.g. ConflictError('invoice_issued'), ConflictError('overpayment'). */
export class ConflictError extends AppError {
  constructor(code: string, message?: string) {
    super(code, message ?? humanizeCode(code));
  }
}

/** Input failed validation; `fieldErrors` mirrors zod's flattened field errors. */
export class ValidationError extends AppError {
  readonly fieldErrors: Record<string, string[]>;
  constructor(
    fieldErrors: Record<string, string[]>,
    message = "Please fix the highlighted fields.",
  ) {
    super("validation", message);
    this.fieldErrors = fieldErrors;
  }
}

export class FeatureDisabledError extends AppError {
  readonly flag: string;
  constructor(flag: string) {
    super(
      "feature_disabled",
      "This feature is turned off in Settings → Features.",
      `Feature disabled: ${flag}`,
    );
    this.flag = flag;
  }
}

/** The deployment is missing required settings (e.g. SESSION_SECRET): HTTP 503. */
export class ConfigError extends AppError {
  constructor(message: string) {
    super(
      "server_misconfigured",
      "The server is missing required settings. Tell an admin.",
      message,
    );
  }
}

export class RateLimitedError extends AppError {
  readonly retryAfterSec: number;
  constructor(
    retryAfterSec = 60,
    message = "Too many attempts. Please wait and try again.",
  ) {
    super("rate_limited", message);
    this.retryAfterSec = retryAfterSec;
  }
}

function humanizeCode(code: string): string {
  const s = code.replace(/[_.-]+/g, " ").trim();
  return s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}.` : "Conflict.";
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
