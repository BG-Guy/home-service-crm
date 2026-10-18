"use client";

import { ExternalLink, Star } from "lucide-react";
import { useState } from "react";
import { Button, buttonClass } from "@/ui/components/Button";
import { TextArea } from "@/ui/components/Field";
import { Toggle } from "@/ui/components/Toggle";
import { cx } from "@/ui/cx";
import { submitReviewRating } from "../public-actions";

const WORDS = ["", "Poor", "Fair", "OK", "Good", "Great"];

/**
 * Optional "How did we do?" (SPEC M14). Sentiment-neutral: the Google button is shown
 * to everyone, whatever the rating. Ratings ≤ 3 additionally see the owner-call offer.
 */
export function RatingCard({
  token,
  googleUrl,
  companyName,
  initialRating,
}: {
  token: string;
  googleUrl: string | null;
  companyName: string;
  initialRating: number | null;
}) {
  const [rating, setRating] = useState<number | null>(initialRating);
  const [feedback, setFeedback] = useState("");
  const [callMe, setCallMe] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "done">(
    initialRating ? "done" : "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!rating) return;
    setState("sending");
    setError(null);
    const res = await submitReviewRating({
      token,
      rating,
      feedback: feedback || undefined,
      wantsCallback: rating <= 3 ? callMe : undefined,
    });
    if (res.ok) setState("done");
    else {
      setState("idle");
      setError(res.error);
    }
  };

  const google = googleUrl ? (
    <a
      href={googleUrl}
      rel="noopener noreferrer"
      className={buttonClass({
        variant: "filled",
        size: "lg",
        fullWidth: true,
      })}
    >
      Leave a Google review
      <ExternalLink aria-hidden size={18} className="ml-1" />
    </a>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <section className="list-card px-5 py-6 text-center">
        <h1 className="text-title1 font-bold tracking-tight">
          {state === "done" ? "Thank you!" : "How did we do?"}
        </h1>
        <p className="mt-1 text-subhead text-label-2">
          {state === "done"
            ? `Your feedback goes straight to ${companyName}.`
            : `Tap a star to rate your visit from ${companyName}.`}
        </p>
        <fieldset className="mt-5 flex justify-center gap-1 border-0 p-0">
          <legend className="sr-only">Rating, 1 to 5 stars</legend>
          {[1, 2, 3, 4, 5].map((n) => {
            const on = (rating ?? 0) >= n;
            return (
              <button
                key={n}
                type="button"
                aria-pressed={rating === n}
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
                disabled={state !== "idle"}
                onClick={() => setRating(n)}
                className="flex size-12 items-center justify-center rounded-full transition-transform duration-200 ease-[var(--ease-spring)] active:scale-90 disabled:active:scale-100"
              >
                <Star
                  aria-hidden
                  size={36}
                  strokeWidth={1.75}
                  className={cx(
                    on
                      ? "fill-[var(--sys-yellow)] text-[var(--sys-yellow)]"
                      : "text-label-3",
                  )}
                />
              </button>
            );
          })}
        </fieldset>
        {rating && (
          <p className="mt-2 text-subhead text-label-2">{WORDS[rating]}</p>
        )}
      </section>

      {rating && state !== "done" && (
        <section className="list-card flex flex-col gap-3 px-5 py-5">
          <TextArea
            label={
              rating <= 3
                ? "What could we have done better?"
                : "Anything to add? (optional)"
            }
            value={feedback}
            rows={3}
            onChange={(e) => setFeedback(e.currentTarget.value)}
          />
          {rating <= 3 && (
            // biome-ignore lint/a11y/noLabelWithoutControl: the Toggle input is a descendant
            <label className="flex min-h-11 items-center justify-between gap-3">
              <span className="text-body">Want the owner to call you?</span>
              <Toggle
                label="Owner callback"
                checked={callMe}
                onChange={(e) => setCallMe(e.currentTarget.checked)}
              />
            </label>
          )}
          {error && <p className="text-footnote text-danger">{error}</p>}
          <Button
            variant="tinted"
            size="lg"
            fullWidth
            loading={state === "sending"}
            onClick={send}
          >
            Send feedback
          </Button>
        </section>
      )}

      {state === "done" && rating !== null && rating <= 3 && callMe && (
        <p className="px-1 text-center text-subhead text-label-2">
          We&apos;ll call you soon.
        </p>
      )}

      {google && (
        <section className="flex flex-col gap-2">
          {google}
          <p className="px-1 text-center text-footnote text-label-2">
            Reviews help neighbors find a good tech. Totally optional.
          </p>
        </section>
      )}
    </div>
  );
}
