// Golden: the invoice screen's plain words and photo labels (Quote to Paid, Part I).
import { describe, expect, it } from "vitest";
import type { DocCredit } from "@/features/invoices/money-lines";
import {
  INVOICE_PHOTO_TAGS,
  invoiceLabelTag,
  invoicePhotoLabel,
  isInvoicePhotoTag,
} from "@/features/invoices/photo-labels";
import {
  balanceParts,
  creditTotals,
  customerShortName,
  describeSend,
  minusMoney,
  qtyName,
  type SendOutcome,
} from "@/features/invoices/screen-copy";
import { nothingDueMessage } from "@/features/payments/collect-copy";

describe("the customer in a sentence", () => {
  it("a person's first name; a business keeps its whole name", () => {
    expect(
      customerShortName({ displayName: "Sophia Taylor", type: "residential" }),
    ).toBe("Sophia");
    expect(customerShortName({ displayName: "Sophia Taylor" })).toBe("Sophia");
    expect(
      customerShortName({
        displayName: "Highlands Rentals LLC",
        type: "property_manager",
      }),
    ).toBe("Highlands Rentals LLC");
  });
});

describe("balance line", () => {
  it("names the approved option while the invoice bills exactly what was signed", () => {
    expect(
      balanceParts({
        totalCents: 45_073,
        optionLabel: "Better",
        signedTotalCents: 45_073,
        depositCents: 9_000,
        paidCents: 0,
        creditCents: 0,
      }),
    ).toEqual([
      { text: "Better $450.73" },
      { text: "Deposit −$90.00", off: true },
    ]);
  });

  it("says Total once the invoice differs from the signed option (it still adds up)", () => {
    expect(
      balanceParts({
        totalCents: 50_000,
        optionLabel: "Better",
        signedTotalCents: 45_073,
        depositCents: 9_000,
        paidCents: 10_000,
        creditCents: 1_500,
      }).map((p) => p.text),
    ).toEqual([
      "Total $500.00",
      "Deposit −$90.00",
      "Paid −$100.00",
      "Credits −$15.00",
    ]);
  });

  it("no estimate, nothing paid: just the total", () => {
    expect(
      balanceParts({
        totalCents: 14_036,
        depositCents: 0,
        paidCents: 0,
        creditCents: 0,
      }),
    ).toEqual([{ text: "Total $140.36" }]);
  });

  it("a refund nets against what it refunded, so the line still adds up", () => {
    const at = new Date("2026-10-20T15:00:00Z");
    const credit = (
      id: string,
      kind: DocCredit["kind"],
      amountCents: number,
      paymentId: string | null = id,
    ): DocCredit => ({
      id,
      kind,
      label: id,
      at,
      amountCents,
      tipCents: 0,
      status: "succeeded",
      paymentId,
    });
    const totals = creditTotals([
      credit("dep", "deposit", 9_000),
      credit("pay", "payment", 20_000),
      credit("tip", "tip_only", 0),
      credit("cn", "credit_note", 1_500, null),
      credit("r1", "refund", -9_000, "dep"), // the deposit, refunded in full
      credit("r2", "refund", -5_000, "pay"), // part of the payment
    ]);
    expect(totals).toEqual({
      depositCents: 0,
      paidCents: 15_000,
      creditCents: 1_500,
    });
    // $500.00 − $150.00 − $15.00 = $335.00 due: every part shown, none hidden.
    expect(
      balanceParts({ totalCents: 50_000, ...totals }).map((p) => p.text),
    ).toEqual(["Total $500.00", "Paid −$150.00", "Credits −$15.00"]);
  });

  it("money and quantities read like a receipt", () => {
    expect(minusMoney(9_000)).toBe("−$90.00");
    expect(minusMoney(-9_000)).toBe("−$90.00");
    expect(qtyName(1, "Rekey")).toBe("Rekey");
    expect(qtyName(2, "Grade 1 deadbolt")).toBe("2 × Grade 1 deadbolt");
    expect(qtyName(1.5, "Labor")).toBe("1.5 × Labor");
  });
});

describe("send results in plain words", () => {
  const base: SendOutcome = {
    status: "pending_tap",
    channel: "sms",
    to: "(303) 555-0117",
    reason: null,
    sendAtLabel: null,
    mine: true,
  };
  const who = { firstName: "Sophia" };

  it("a text in your own outbox: tap to send it from your phone", () => {
    expect(describeSend(base, who)).toEqual({
      tone: "info",
      title: "Ready to text",
      detail: "Tap Send to text it from your phone.",
    });
  });

  it("a text in the office outbox says so (the number stays hidden)", () => {
    expect(describeSend({ ...base, mine: false }, who).title).toBe(
      "Waiting in the office outbox",
    );
    expect(
      describeSend({ ...base, mine: false }, { ...who, what: "receipt" })
        .detail,
    ).toBe("The office texts the receipt to Sophia from there.");
  });

  it("emailed / texted say where", () => {
    expect(
      describeSend(
        {
          ...base,
          status: "scheduled",
          channel: "email",
          to: "sophia@example.com",
        },
        who,
      ).title,
    ).toBe("Emailed to sophia@example.com");
    expect(describeSend({ ...base, status: "sent" }, who).title).toBe(
      "Texted to (303) 555-0117",
    );
  });

  it("quiet hours say when", () => {
    expect(
      describeSend(
        { ...base, status: "deferred_quiet", sendAtLabel: "8:00 AM" },
        who,
      ),
    ).toEqual({
      tone: "warning",
      title: "Will send at 8:00 AM",
      detail: "Held for quiet hours.",
    });
  });

  it("not sent says why", () => {
    expect(describeSend({ ...base, status: "suppressed_optout" }, who)).toEqual(
      {
        tone: "error",
        title: "Not sent",
        detail: "Sophia opted out of texts. Try email.",
      },
    );
    expect(
      describeSend(
        {
          ...base,
          status: "skipped",
          channel: "email",
          reason: "No email address on file.",
        },
        who,
      ).detail,
    ).toBe("No email address on file.");
  });
});

describe("invoice photo labels (the owner's note)", () => {
  it("Before / During / After; a Problem photo is a Before", () => {
    expect(invoicePhotoLabel("before")).toBe("Before");
    expect(invoicePhotoLabel("problem")).toBe("Before");
    expect(invoicePhotoLabel("during")).toBe("During");
    expect(invoicePhotoLabel("after")).toBe("After");
    expect(invoicePhotoLabel("other")).toBe("Photo");
    expect(invoicePhotoLabel(null)).toBe("Photo");
    expect(invoiceLabelTag("problem")).toBe("before");
    expect(invoiceLabelTag("other")).toBeNull();
  });

  it("Goal photos (estimate-only) never go on an invoice", () => {
    expect(isInvoicePhotoTag("goal")).toBe(false);
    expect(INVOICE_PHOTO_TAGS).not.toContain("goal");
    expect(isInvoicePhotoTag("problem")).toBe(true);
  });
});

describe("nothing to collect", () => {
  const ctx = {
    invoiceNumber: "INV-1067",
    invoiceStatus: "draft",
    invoiceHasLines: false,
    totalCents: 0,
  };
  it("an empty draft isn't 'paid in full'", () => {
    expect(nothingDueMessage(ctx)).toBe(
      "Nothing to collect yet. Add items to INV-1067 first.",
    );
    expect(nothingDueMessage({ ...ctx, invoiceHasLines: true })).toBe(
      "INV-1067 totals $0.00, so there's nothing to collect.",
    );
    // A draft the deposit already covers isn't a $0 invoice either.
    expect(
      nothingDueMessage({ ...ctx, invoiceHasLines: true, totalCents: 45_073 }),
    ).toBe("Deposits and payments already cover INV-1067.");
  });
  it("paid, void, written off, no invoice", () => {
    expect(nothingDueMessage({ ...ctx, invoiceStatus: "paid" })).toBe(
      "INV-1067 is paid in full.",
    );
    expect(nothingDueMessage({ ...ctx, invoiceStatus: "void" })).toBe(
      "INV-1067 was voided.",
    );
    expect(nothingDueMessage({ ...ctx, invoiceStatus: "uncollectible" })).toBe(
      "INV-1067 was written off.",
    );
    expect(nothingDueMessage({ ...ctx, invoiceNumber: null })).toBe(
      "There's no invoice or deposit to collect yet.",
    );
  });
});
