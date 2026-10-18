import { z } from "zod";

// Plain-language validation messages (QA T3-12). zod's defaults read like
// "Too small: expected string to have >=1 characters". A schema's own message
// (`z.string().min(1, "Add a name")`) still wins; this is the global fallback,
// installed once by `action()` (src/lib/action.ts).

type Issue = Parameters<NonNullable<z.core.$ZodConfig["customError"]>>[0];

const n = (v: number | bigint) => Number(v).toLocaleString("en-US");

/** A friendly message for a zod issue, or undefined to keep zod's default. */
export function friendlyZodMessage(issue: Issue): string | undefined {
  switch (issue.code) {
    case "invalid_type": {
      if (
        issue.input === undefined ||
        issue.input === null ||
        issue.input === ""
      )
        return "Required.";
      const e = issue.expected;
      if (e === "number" || e === "int" || e === "bigint")
        return "Enter a number.";
      if (e === "date") return "Enter a valid date.";
      if (e === "boolean") return "Choose yes or no.";
      if (e === "array") return "Choose at least one.";
      return "Enter a valid value.";
    }
    case "too_small": {
      const min = issue.minimum;
      switch (issue.origin) {
        case "string":
          return Number(min) <= 1
            ? "Required."
            : issue.exact
              ? `Use exactly ${n(min)} characters.`
              : `Use at least ${n(min)} characters.`;
        case "array":
        case "set":
          return Number(min) <= 1
            ? "Choose at least one."
            : `Choose at least ${n(min)}.`;
        case "number":
        case "int":
        case "bigint":
          return issue.inclusive === false
            ? `Must be more than ${n(min)}.`
            : `Must be at least ${n(min)}.`;
        case "date":
          return "That date is too early.";
        default:
          return undefined;
      }
    }
    case "too_big": {
      const max = issue.maximum;
      switch (issue.origin) {
        case "string":
          return `Use ${n(max)} characters or fewer.`;
        case "array":
        case "set":
          return `Choose ${n(max)} or fewer.`;
        case "number":
        case "int":
        case "bigint":
          return issue.inclusive === false
            ? `Must be less than ${n(max)}.`
            : `Must be ${n(max)} or less.`;
        case "date":
          return "That date is too late.";
        case "file":
          return "That file is too large.";
        default:
          return undefined;
      }
    }
    case "invalid_format":
      switch (issue.format) {
        case "email":
          return "Enter a valid email address.";
        case "url":
          return "Enter a valid web address (https://…).";
        case "uuid":
        case "guid":
          return "That record wasn't found.";
        case "date":
        case "datetime":
          return "Enter a valid date.";
        case "time":
          return "Enter a valid time.";
        default:
          return "That doesn't look right.";
      }
    case "invalid_value":
      return "Choose one of the options.";
    case "not_multiple_of":
      return `Must be a multiple of ${n(issue.divisor as number)}.`;
    case "unrecognized_keys":
      return undefined;
    default:
      return undefined;
  }
}

let installed = false;

/** Install the friendly messages as zod's global fallback (idempotent). */
export function installFriendlyZodMessages(): void {
  if (installed) return;
  installed = true;
  z.config({ customError: (issue) => friendlyZodMessage(issue) });
}
