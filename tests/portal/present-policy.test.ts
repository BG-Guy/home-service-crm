import { describe, expect, it } from "vitest";
import { presentationCloses } from "@/features/portal/present-policy";

describe("present mode close rule", () => {
  it("pauses on back (the URL lost ?fs=present)", () => {
    expect(presentationCloses({ urlHasKey: false, otherHubOpen: false })).toBe(
      true,
    );
  });

  it("keeps presenting on Esc, the close button or leaving browser full screen", () => {
    expect(presentationCloses({ urlHasKey: true, otherHubOpen: false })).toBe(
      false,
    );
  });

  it("ignores the full-screen exit a closing signature pad or photo causes", () => {
    // The nested hub drops browser full screen while its own history entry is
    // still being popped: neither must end the presentation.
    expect(presentationCloses({ urlHasKey: false, otherHubOpen: true })).toBe(
      false,
    );
    expect(presentationCloses({ urlHasKey: true, otherHubOpen: true })).toBe(
      false,
    );
  });
});
