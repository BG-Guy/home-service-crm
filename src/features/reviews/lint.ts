// Review-request template linter (SPEC M14 ⚖️, hard rule — not configurable). Pure,
// client-safe: the template editor runs it live and the save action enforces it.
//
// 1. No incentives: discount, coupon, % off, free, gift card, prize, raffle… near
//    "review" (anywhere in a review-purpose template). FTC 16 CFR 465 + Google policy.
// 2. No sentiment gating: wording that asks only happy customers ("if you loved us",
//    "5 stars") — who gets asked never depends on sentiment.
// 3. Yelp is never a target (Yelp forbids solicitation).

export interface ReviewLintIssue {
  rule: "incentive" | "gating" | "yelp";
  match: string;
  message: string;
}

const INCENTIVE =
  /\$\s*\d+\s*off\b|\d+\s*%\s*off\b|%\s*off\b|\b(?:discount(?:s|ed)?|coupons?|promo(?:\s*code)?|free|gift\s*cards?|gifts?|prizes?|raffles?|giveaways?|sweepstakes|rewards?|cash\s*back|credits?|enter(?:ed)?\s+to\s+win|drawing)\b/gi;
const INCENTIVE_VARS =
  /\{\{\s*(?:[\w.]*\b(?:discount|coupon|promo|reward|gift|offer)\b[\w.]*)/gi;
const GATING =
  /\b(5[-\s]?stars?|five[-\s]?stars?|if you (?:were|are) (?:happy|satisfied|pleased)|if you (?:loved|liked|enjoyed)|only if|happy customers?|positive review|good review|great review)\b/gi;
const YELP = /\byelp\b/gi;
const REVIEW_WORD = /\breviews?\b/gi;

/** How close (characters) an incentive word must be to "review" in non-review templates. */
export const NEAR_CHARS = 80;

function near(text: string, index: number): boolean {
  for (const m of text.matchAll(REVIEW_WORD)) {
    if (Math.abs((m.index ?? 0) - index) <= NEAR_CHARS) return true;
  }
  return false;
}

/**
 * Lint a template body (and subject). `purpose === 'review'` treats the whole text as
 * review context; other purposes flag incentive words only near "review".
 */
export function lintReviewTemplate(
  text: string,
  purpose: string = "review",
): ReviewLintIssue[] {
  const issues: ReviewLintIssue[] = [];
  const isReview = purpose === "review";
  const seen = new Set<string>();
  const add = (i: ReviewLintIssue) => {
    const k = `${i.rule}:${i.match.toLowerCase()}`;
    if (seen.has(k)) return;
    seen.add(k);
    issues.push(i);
  };
  for (const m of text.matchAll(INCENTIVE)) {
    if (isReview || near(text, m.index ?? 0))
      add({
        rule: "incentive",
        match: m[0],
        message: `"${m[0]}" looks like an incentive. Offering anything for a review breaks FTC rules and Google policy.`,
      });
  }
  for (const m of text.matchAll(INCENTIVE_VARS)) {
    if (isReview || near(text, m.index ?? 0))
      add({
        rule: "incentive",
        match: m[0],
        message: `Incentive variables aren't allowed in review requests.`,
      });
  }
  if (isReview || REVIEW_WORD.test(text)) {
    REVIEW_WORD.lastIndex = 0;
    for (const m of text.matchAll(GATING))
      add({
        rule: "gating",
        match: m[0],
        message: `"${m[0]}" steers who leaves a review. Ask every customer the same way, whatever their experience.`,
      });
    for (const m of text.matchAll(YELP))
      add({
        rule: "yelp",
        match: m[0],
        message: "Yelp forbids asking for reviews — use the Google link only.",
      });
  }
  return issues;
}
