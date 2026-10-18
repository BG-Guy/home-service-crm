// Where payment and refund rows lead: job invoice tab → invoice → customer, each
// only when the viewer may open it.
import { describe, expect, it } from "vitest";
import { paymentHref, paymentLinkAccess } from "@/features/payments/links";

const perms = (...p: string[]) => new Set(p);
const all = { jobs: true, invoices: true, customers: true };

describe("paymentHref", () => {
  it("prefers the job's invoice tab, then the invoice, then the customer", () => {
    expect(
      paymentHref({ jobId: "j1", invoiceId: "i1", customerId: "c1" }, all),
    ).toBe("/jobs/j1?tab=invoice");
    expect(
      paymentHref({ jobId: null, invoiceId: "i1", customerId: "c1" }, all),
    ).toBe("/invoices/i1");
    expect(
      paymentHref({ jobId: null, invoiceId: null, customerId: "c1" }, all),
    ).toBe("/customers/c1");
    expect(
      paymentHref({ jobId: null, invoiceId: null, customerId: null }, all),
    ).toBeNull();
  });

  it("skips what the viewer can't open", () => {
    const p = { jobId: "j1", invoiceId: "i1", customerId: "c1" };
    expect(paymentHref(p, { ...all, jobs: false })).toBe("/invoices/i1");
    expect(
      paymentHref(p, { jobs: false, invoices: false, customers: true }),
    ).toBe("/customers/c1");
    expect(
      paymentHref(p, { jobs: false, invoices: false, customers: false }),
    ).toBeNull();
  });
});

describe("paymentLinkAccess", () => {
  it("asks for company-wide access, since the rows aren't the viewer's own", () => {
    expect(
      paymentLinkAccess(
        perms("jobs.view_all", "invoices.view", "customers.view_all"),
      ),
    ).toEqual(all);
    // A tech's own-jobs grants don't cover everyone's payments.
    expect(
      paymentLinkAccess(
        perms("jobs.view_own", "invoices.view", "customers.view"),
      ),
    ).toEqual({ jobs: false, invoices: false, customers: false });
  });
});
