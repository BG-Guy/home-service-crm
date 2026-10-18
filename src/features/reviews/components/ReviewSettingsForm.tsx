"use client";

import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { Select, TextField } from "@/ui/components/Field";
import { ListSection } from "@/ui/components/List";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import { saveReviewSettings } from "../actions";

export interface ReviewSettingsInitial {
  google_url: string | null;
  min_days_between: number;
  delay_minutes: number;
  reminder_enabled: boolean;
  internal_rating_page: boolean;
  consent_basis: "transactional" | "marketing";
  skip_no_charge_callbacks: boolean;
  max_days_after_completion: number;
}

export function ReviewSettingsForm({
  initial,
}: {
  initial: ReviewSettingsInitial;
}) {
  const [v, setV] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const set = <K extends keyof ReviewSettingsInitial>(
    k: K,
    val: ReviewSettingsInitial[K],
  ) => setV((p) => ({ ...p, [k]: val }));
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);

  const save = async () => {
    setSaving(true);
    const res = await saveReviewSettings({
      ...v,
      google_url: v.google_url || null,
    });
    setSaving(false);
    if (res.ok) {
      setErrors({});
      toast({ title: "Review settings saved", tone: "success" });
    } else {
      setErrors(res.fieldErrors ?? {});
      toast({ title: "Couldn't save", message: res.error, tone: "error" });
    }
  };

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <ListSection
        header="Google review link"
        footer="In Google Business Profile, tap “Ask for reviews” and copy the link (g.page/r/…). Customers always get it through your own /r/ link, so clicks are counted."
      >
        <div className="flex flex-col gap-3 px-4 py-3">
          <TextField
            label="Review link"
            value={v.google_url ?? ""}
            placeholder="https://g.page/r/…/review"
            inputMode="url"
            error={errors.google_url}
            onChange={(e) => set("google_url", e.currentTarget.value)}
          />
          <Button
            variant="gray"
            size="sm"
            className="self-start"
            icon={<ExternalLink aria-hidden size={16} />}
            disabled={!v.google_url}
            onClick={() =>
              v.google_url && window.open(v.google_url, "_blank", "noopener")
            }
          >
            Test link
          </Button>
        </div>
      </ListSection>

      <ListSection header="Timing">
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
          <Select
            label="Ask after the job is paid"
            value={String(v.delay_minutes)}
            options={[60, 75, 90, 105, 120].map((n) => ({
              value: String(n),
              label:
                n === 60 ? "1 hour" : n === 120 ? "2 hours" : `${n} minutes`,
            }))}
            onChange={(e) =>
              set("delay_minutes", Number(e.currentTarget.value))
            }
          />
          <TextField
            label="Only ask for jobs finished in the last (days)"
            hint="A job paid or closed later than this gets no automatic ask."
            inputMode="numeric"
            value={String(v.max_days_after_completion)}
            error={errors.max_days_after_completion}
            onChange={(e) =>
              set(
                "max_days_after_completion",
                Number(e.currentTarget.value.replace(/\D/g, "")) || 0,
              )
            }
          />
          <TextField
            label="Don't ask the same customer again within (days)"
            inputMode="numeric"
            value={String(v.min_days_between)}
            error={errors.min_days_between}
            onChange={(e) =>
              set(
                "min_days_between",
                Number(e.currentTarget.value.replace(/\D/g, "")) || 0,
              )
            }
          />
        </div>
        <ToggleRow
          title="One reminder after 3 days"
          subtitle="Only if they haven't opened the link. Never more than two asks per job."
          checked={v.reminder_enabled}
          onChange={(e) => set("reminder_enabled", e.currentTarget.checked)}
        />
        <ToggleRow
          title="Skip no-charge callbacks"
          subtitle="Don't ask after a free return visit"
          checked={v.skip_no_charge_callbacks}
          onChange={(e) =>
            set("skip_no_charge_callbacks", e.currentTarget.checked)
          }
        />
      </ListSection>

      <ListSection
        header="“How did we do?” page"
        footer="Everyone sees the Google button, whatever they rate. Ratings of 3 or less also get an offer for the owner to call, and you get an alert."
      >
        <ToggleRow
          title="Show a 1–5 rating first"
          subtitle="Off: the link goes straight to Google"
          checked={v.internal_rating_page}
          onChange={(e) => set("internal_rating_page", e.currentTarget.checked)}
        />
      </ListSection>

      <ListSection header="Consent basis">
        <div className="flex flex-col gap-3 px-4 py-3">
          <SegmentedControl
            label="Who can get review texts"
            value={v.consent_basis}
            segments={[
              { value: "transactional", label: "Appointment texts" },
              { value: "marketing", label: "Marketing only" },
            ]}
            onChange={(x) => set("consent_basis", x)}
          />
          <Banner tone="legal" title="Check your state's rules">
            {v.consent_basis === "transactional"
              ? "Review texts go to customers who agreed to appointment texts and haven't opted out. Some lawyers treat review asks as marketing — switch to “Marketing only” to be conservative (others get an email)."
              : "Only customers who agreed to marketing texts get a review text; everyone else gets an email."}
          </Banner>
          <Banner tone="info">
            Review requests never offer discounts or gifts, never steer only
            happy customers, and never point to Yelp. Templates that do are
            blocked.
          </Banner>
        </div>
      </ListSection>

      <div className="flex justify-end">
        <Button
          variant="filled"
          disabled={!dirty}
          loading={saving}
          onClick={save}
        >
          Save changes
        </Button>
      </div>
    </div>
  );
}
