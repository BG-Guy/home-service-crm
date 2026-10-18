// Channel resolution for customer_preferred and consent gating (SPEC §7.2, M12, M14).
import { describe, expect, it } from "vitest";
import {
  type ChannelContext,
  type ConsentFacts,
  consentDecision,
  resolveCustomerChannel,
} from "@/features/messaging/compliance";

const f = (o: Partial<ConsentFacts> = {}): ConsentFacts => ({
  smsStatus: "transactional",
  doNotText: false,
  doNotContact: false,
  hasPhone: true,
  hasEmail: true,
  ...o,
});
const c = (o: Partial<ChannelContext> = {}): ChannelContext => ({
  purpose: "transactional",
  whatsappEnabled: false,
  reviewConsentBasis: "transactional",
  ...o,
});

describe("resolveCustomerChannel", () => {
  it("SMS when allowed; unknown status still OK for transactional with a phone", () => {
    expect(resolveCustomerChannel(f(), c())).toEqual({
      ok: true,
      channel: "sms",
    });
    expect(resolveCustomerChannel(f({ smsStatus: "unknown" }), c())).toEqual({
      ok: true,
      channel: "sms",
    });
  });
  it("preferred email / whatsapp", () => {
    expect(resolveCustomerChannel(f({ preferred: "email" }), c())).toEqual({
      ok: true,
      channel: "email",
    });
    expect(resolveCustomerChannel(f({ preferred: "whatsapp" }), c())).toEqual({
      ok: true,
      channel: "sms",
    });
    expect(
      resolveCustomerChannel(
        f({ preferred: "whatsapp" }),
        c({ whatsappEnabled: true }),
      ),
    ).toEqual({
      ok: true,
      channel: "whatsapp",
    });
  });
  it("opted out → email, else skip with a reason", () => {
    expect(resolveCustomerChannel(f({ smsStatus: "opted_out" }), c())).toEqual({
      ok: true,
      channel: "email",
    });
    expect(
      resolveCustomerChannel(
        f({ smsStatus: "opted_out", hasEmail: false }),
        c(),
      ),
    ).toEqual({
      ok: false,
      reason: "opted_out_no_email",
    });
    expect(resolveCustomerChannel(f({ doNotContact: true }), c())).toEqual({
      ok: false,
      reason: "do_not_contact",
    });
    expect(
      resolveCustomerChannel(f({ hasPhone: false, hasEmail: false }), c()),
    ).toEqual({
      ok: false,
      reason: "no_contact",
    });
  });
  it("marketing needs marketing consent (email needs an email marketing grant)", () => {
    expect(resolveCustomerChannel(f(), c({ purpose: "marketing" }))).toEqual({
      ok: false,
      reason: "no_consent_marketing",
    });
    expect(
      resolveCustomerChannel(
        f({ emailMarketing: true }),
        c({ purpose: "marketing" }),
      ),
    ).toEqual({
      ok: true,
      channel: "email",
    });
    expect(
      resolveCustomerChannel(
        f({ smsStatus: "marketing" }),
        c({ purpose: "marketing" }),
      ),
    ).toEqual({
      ok: true,
      channel: "sms",
    });
  });
  it("review consent basis ⚖️", () => {
    expect(resolveCustomerChannel(f(), c({ purpose: "review" }))).toEqual({
      ok: true,
      channel: "sms",
    });
    expect(
      resolveCustomerChannel(
        f({ smsStatus: "unknown" }),
        c({ purpose: "review" }),
      ),
    ).toEqual({
      ok: true,
      channel: "email",
    });
    expect(
      resolveCustomerChannel(
        f(),
        c({ purpose: "review", reviewConsentBasis: "marketing" }),
      ),
    ).toEqual({ ok: true, channel: "email" });
  });
});

describe("consentDecision", () => {
  it("opted out / do-not-text suppress automated texts", () => {
    expect(consentDecision("sms", f({ smsStatus: "opted_out" }), c())).toEqual({
      ok: false,
      status: "suppressed_optout",
      reason: "opted_out",
    });
    expect(consentDecision("sms", f({ doNotText: true }), c())).toMatchObject({
      ok: false,
      reason: "do_not_text",
    });
  });
  it("manual transactional override after the warning; never marketing or review", () => {
    expect(
      consentDecision("sms", f({ smsStatus: "opted_out" }), c(), true),
    ).toEqual({ ok: true });
    expect(
      consentDecision(
        "sms",
        f({ smsStatus: "opted_out" }),
        c({ purpose: "marketing" }),
        true,
      ).ok,
    ).toBe(false);
    expect(
      consentDecision(
        "sms",
        f({ smsStatus: "opted_out" }),
        c({ purpose: "review" }),
        true,
      ).ok,
    ).toBe(false);
    expect(
      consentDecision("sms", f({ doNotContact: true }), c(), true).ok,
    ).toBe(false);
  });
  it("test customers only get transactional messages", () => {
    expect(
      consentDecision("sms", f({ isTest: true }), c({ purpose: "review" })),
    ).toMatchObject({
      ok: false,
      reason: "test_customer",
    });
  });
  it("internal is never gated", () => {
    expect(
      consentDecision(
        "push",
        f({ doNotContact: true }),
        c({ purpose: "internal" }),
      ),
    ).toEqual({ ok: true });
  });
});
