// ★ Golden: review-request incentive / gating / Yelp linter (SPEC M14, hard rule).
import { describe, expect, it } from "vitest";
import { lintReviewTemplate } from "@/features/reviews/lint";

const rules = (t: string, p?: string) =>
  lintReviewTemplate(t, p).map((i) => i.rule);

describe("lintReviewTemplate", () => {
  it("the default review texts pass", () => {
    expect(
      lintReviewTemplate(
        "Thanks for choosing {{company.name}} today. Would you share your experience? {{review.link}}",
      ),
    ).toEqual([]);
    expect(
      lintReviewTemplate(
        "Quick reminder: if you have a minute, we'd love your feedback: {{review.link}}",
      ),
    ).toEqual([]);
  });

  it.each([
    "Leave a review and get 10% off your next visit",
    "Review us for a free filter!",
    "Leave a review, enter to win a gift card",
    "Use coupon REVIEW5 after you review us",
    "Get $20 off when you post a review",
    "Reviews earn you rewards points",
    "Review us and get a discount",
  ])("incentive: %s", (text) => {
    expect(rules(text)).toContain("incentive");
  });

  it("incentive variables are rejected", () => {
    expect(
      rules("Review us: {{review.link}} {{offer.discount_code}}"),
    ).toContain("incentive");
  });

  it.each([
    "If you loved our service, leave us 5 stars!",
    "Happy customers, please leave a review",
    "Only if you were satisfied, review us",
    "We'd appreciate a positive review",
  ])("gating: %s", (text) => {
    expect(rules(text)).toContain("gating");
  });

  it("Yelp is never a target", () => {
    expect(rules("Please review us on Yelp")).toContain("yelp");
  });

  it("non-review templates only flag incentives near the word review", () => {
    expect(rules("Spring promo: 10% off AC tune-ups", "marketing")).toEqual([]);
    expect(
      rules(
        "Spring promo: 10% off AC tune-ups. Leave a review too!",
        "marketing",
      ),
    ).toContain("incentive");
  });
});
