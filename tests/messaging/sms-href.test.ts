// smsHref per user agent + override; waHref (SPEC §9.1).
import { describe, expect, it } from "vitest";
import { smsHref, telHref, waHref } from "@/client/sms-href";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8)";

describe("smsHref", () => {
  it("Apple uses &body=, others ?body=", () => {
    expect(smsHref("+15125550123", "Hi", IPHONE)).toBe(
      "sms:+15125550123&body=Hi",
    );
    expect(smsHref("+15125550123", "Hi", ANDROID)).toBe(
      "sms:+15125550123?body=Hi",
    );
    expect(
      smsHref(
        "+15125550123",
        "Hi",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
      ),
    ).toBe("sms:+15125550123&body=Hi");
  });
  it("override wins over the user agent", () => {
    expect(smsHref("+15125550123", "Hi", IPHONE, "?")).toBe(
      "sms:+15125550123?body=Hi",
    );
    expect(smsHref("+15125550123", "Hi", ANDROID, "?&")).toBe(
      "sms:+15125550123?&body=Hi",
    );
  });
  it("bodies are always URI-encoded; numbers are cleaned; empty body = plain link", () => {
    expect(smsHref("+1 (512) 555-0123", "A&B ? 50% #1\nok", ANDROID)).toBe(
      `sms:+15125550123?body=${encodeURIComponent("A&B ? 50% #1\nok")}`,
    );
    expect(smsHref("+15125550123", "", ANDROID)).toBe("sms:+15125550123");
  });
  it("wa.me + tel", () => {
    expect(waHref("+1 512-555-0123", "Hi there")).toBe(
      "https://wa.me/15125550123?text=Hi%20there",
    );
    expect(telHref("+1 (512) 555-0123")).toBe("tel:+15125550123");
  });
});
