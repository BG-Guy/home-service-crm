import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES } from "@/features/notify/catalog";
import { notifyKind, openLabel } from "@/features/notify/kinds";

describe("notification kinds", () => {
  it("gives every catalog type its own icon and color (only the catch-all is the gray bell)", () => {
    for (const t of NOTIFICATION_TYPES) {
      const k = notifyKind(t.key);
      if (t.key === "staff.generic") continue;
      expect(k.label, t.key).not.toBe("Notification");
    }
    expect(notifyKind("staff.message_received").label).toBe("New text");
    expect(notifyKind("staff.message_received").category).toBe("messages");
    expect(notifyKind("something.new").label).toBe("Notification");
  });

  it("names the page the Open button goes to", () => {
    expect(openLabel("/leads?lead=1")).toBe("Open lead");
    expect(openLabel("/jobs/abc")).toBe("Open job");
    expect(openLabel("/messages/abc")).toBe("Open conversation");
    expect(openLabel("/messages/outbox")).toBe("Open outbox");
    expect(openLabel("/somewhere")).toBe("Open");
    expect(openLabel(null)).toBe("Open");
  });
});
