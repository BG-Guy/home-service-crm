import { describe, expect, it } from "vitest";
import { z } from "zod";
import { installFriendlyZodMessages } from "@/lib/zod-messages";

installFriendlyZodMessages();
const msg = (schema: z.ZodType, v: unknown) =>
  schema.safeParse(v).error?.issues[0]?.message;

describe("friendly validation messages (QA T3-12)", () => {
  it("plain language for the common cases", () => {
    expect(msg(z.string().min(1), "")).toBe("Required.");
    expect(msg(z.object({ name: z.string() }), {})).toBe("Required.");
    expect(msg(z.string().min(3), "ab")).toBe("Use at least 3 characters.");
    expect(msg(z.string().max(5), "abcdefg")).toBe(
      "Use 5 characters or fewer.",
    );
    expect(msg(z.number().int().min(0), -1)).toBe("Must be at least 0.");
    expect(msg(z.number().max(1000), 5000)).toBe("Must be 1,000 or less.");
    expect(msg(z.number(), "abc")).toBe("Enter a number.");
    expect(msg(z.email(), "nope")).toBe("Enter a valid email address.");
    expect(msg(z.enum(["a", "b"]), "c")).toBe("Choose one of the options.");
    expect(msg(z.array(z.string()).min(1), [])).toBe("Choose at least one.");
  });
  it("a schema's own message still wins", () => {
    expect(msg(z.string().min(1, "Add a name"), "")).toBe("Add a name");
    expect(
      msg(
        z.string().refine(() => false, "Custom words"),
        "x",
      ),
    ).toBe("Custom words");
  });
});
