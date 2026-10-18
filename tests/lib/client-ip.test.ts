import { describe, expect, it } from "vitest";
import { pickClientIp } from "@/lib/client-ip";

const h = (o: Record<string, string>) => new Headers(o);

describe("client IP behind a trusted proxy (QA T5-13)", () => {
  it("default: the hop the proxy appended (rightmost), not the spoofable leftmost", () => {
    const req = h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" });
    expect(pickClientIp(req, undefined)).toBe("203.0.113.9");
    expect(pickClientIp(req, "1")).toBe("203.0.113.9");
  });
  it("rotating a forged header doesn't change the IP", () => {
    const a = pickClientIp(
      h({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" }),
      "",
    );
    const b = pickClientIp(
      h({ "x-forwarded-for": "2.2.2.2, 203.0.113.9" }),
      "",
    );
    expect(a).toBe(b);
  });
  it("n hops from the right", () => {
    const req = h({ "x-forwarded-for": "6.6.6.6, 198.51.100.4, 10.0.0.2" });
    expect(pickClientIp(req, "2")).toBe("198.51.100.4");
    expect(pickClientIp(req, "9")).toBe("6.6.6.6");
  });
  it("cloudflare / x-real-ip / none", () => {
    const req = h({
      "x-forwarded-for": "6.6.6.6",
      "cf-connecting-ip": "2001:db8::1",
      "x-real-ip": "198.51.100.7",
    });
    expect(pickClientIp(req, "cloudflare")).toBe("2001:db8::1");
    expect(pickClientIp(req, "x-real-ip")).toBe("198.51.100.7");
    expect(pickClientIp(req, "none")).toBeNull();
  });
  it("falls back to x-real-ip without XFF; rejects junk; strips ports", () => {
    expect(pickClientIp(h({ "x-real-ip": "198.51.100.7" }), "")).toBe(
      "198.51.100.7",
    );
    expect(pickClientIp(h({ "x-forwarded-for": "<script>" }), "")).toBeNull();
    expect(pickClientIp(h({ "x-forwarded-for": "203.0.113.9:4431" }), "")).toBe(
      "203.0.113.9",
    );
    expect(pickClientIp(h({ "x-forwarded-for": "[::1]:443" }), "")).toBe("::1");
    expect(pickClientIp(h({}), "")).toBeNull();
  });
});
