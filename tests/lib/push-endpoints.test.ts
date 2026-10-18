import { afterEach, describe, expect, it } from "vitest";
import { isAllowedPushEndpoint } from "@/adapters/push/endpoints";

describe("push endpoint allowlist (QA T5-20)", () => {
  afterEach(() => {
    delete process.env.PUSH_ENDPOINT_HOSTS;
  });
  it("accepts the browser push services", () => {
    for (const u of [
      "https://fcm.googleapis.com/fcm/send/abc:def",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAA",
      "https://web.push.apple.com/QGx2",
      "https://wns2-par02p.notify.windows.com/w/?token=x",
    ])
      expect(isAllowedPushEndpoint(u)).toBe(true);
  });
  it("rejects other hosts, http, ports, credentials and look-alikes", () => {
    for (const u of [
      "https://example.com/push",
      "http://fcm.googleapis.com/fcm/send/x",
      "https://fcm.googleapis.com:8443/x",
      "https://user:pw@fcm.googleapis.com/x",
      "https://fcm.googleapis.com.evil.test/x",
      "https://evilfcm.googleapis.com.attacker.io/x",
      "https://169.254.169.254/latest",
      "not a url",
    ])
      expect(isAllowedPushEndpoint(u)).toBe(false);
  });
  it("PUSH_ENDPOINT_HOSTS adds self-hosted services", () => {
    process.env.PUSH_ENDPOINT_HOSTS = "push.example.org";
    expect(isAllowedPushEndpoint("https://push.example.org/x")).toBe(true);
    expect(isAllowedPushEndpoint("https://a.push.example.org/x")).toBe(true);
  });
});
