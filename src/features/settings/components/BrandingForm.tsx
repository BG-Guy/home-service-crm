"use client";

import { CircleAlert, CircleCheck, RotateCcw } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { normalizeHex } from "@/lib/branding";
import { Button } from "@/ui/components/Button";
import { ListSection } from "@/ui/components/List";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Toggle } from "@/ui/components/Toggle";
import { cx } from "@/ui/cx";
import { setLogoAction, updateBrandingAction } from "../actions";
import { contrastReport } from "../branding-check";
import { SWATCHES } from "../options";
import { ColorSwatches } from "./ColorSwatches";
import {
  FieldCard,
  FormErrors,
  FText,
  StickySave,
  useActionForm,
} from "./form";
import { ImageUpload } from "./ImageUpload";

type HeaderStyle = "standard" | "centered" | "minimal";
type Theme = "system" | "light" | "dark";

/** Apply accent tokens to the whole app while editing (live preview). */
function useLiveAccent(hex: string | null, enabled: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    const keys = ["--accent", "--accent-text", "--on-accent"];
    if (!enabled || !hex) {
      for (const k of keys) root.style.removeProperty(k);
      return;
    }
    const r = contrastReport(hex);
    if (!r) return;
    const dark =
      root.dataset.theme === "dark" ||
      (root.dataset.theme !== "light" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    root.style.setProperty("--accent", r.accent);
    root.style.setProperty(
      "--accent-text",
      dark ? r.accentTextDark : r.accentTextLight,
    );
    root.style.setProperty("--on-accent", r.onAccent);
    return () => {
      for (const k of keys) root.style.removeProperty(k);
    };
  }, [hex, enabled]);
}

export function BrandingForm({
  initial,
  logoUrl,
  logoDarkUrl,
  companyName,
}: {
  initial: {
    accentColor: string | null;
    appName: string;
    invoiceHeaderStyle: HeaderStyle;
    defaultTheme: Theme;
  };
  logoUrl: string | null;
  logoDarkUrl: string | null;
  companyName: string;
}) {
  const [accent, setAccent] = useState(initial.accentColor ?? "");
  const [hexText, setHexText] = useState(initial.accentColor ?? "");
  const [livePreview, setLivePreview] = useState(true);
  const [header, setHeader] = useState<HeaderStyle>(initial.invoiceHeaderStyle);
  const [theme, setTheme] = useState<Theme>(initial.defaultTheme);
  const [appName, setAppName] = useState(initial.appName);
  const valid = accent === "" ? null : normalizeHex(accent);
  const report = useMemo(() => contrastReport(valid), [valid]);
  const dirty = (initial.accentColor ?? "") !== (valid ?? "");
  useLiveAccent(valid, livePreview && dirty);

  const f = useActionForm(updateBrandingAction, { success: "Branding saved" });
  // Read from the result: this component renders <FormErrors>, so the context
  // (useFieldError) isn't available here yet (QA2 T3-22).
  const hexErr = f.errors?.accentColor?.[0];

  const pick = (v: string) => {
    setAccent(v);
    setHexText(v);
  };

  return (
    <FormErrors errors={f.errors}>
      <form {...f.formProps} className="flex flex-col gap-[var(--section-gap)]">
        {/* The typed text is what gets saved, so an invalid hex is rejected by the
            server with a field error instead of silently keeping the old color. */}
        <input type="hidden" name="accentColor" value={hexText.trim()} />
        <input type="hidden" name="invoiceHeaderStyle" value={header} />
        <input type="hidden" name="defaultTheme" value={theme} />

        <FieldCard
          header="Brand color"
          footer="Buttons, switches, links and the selected tab use this color. Text shades are adjusted automatically so they stay readable in light and dark mode."
        >
          <ColorSwatches
            label="Presets"
            allowNone
            value={valid ?? ""}
            onChange={pick}
            options={SWATCHES.map((s) => ({
              value: s.hex.toLowerCase(),
              name: s.name,
            }))}
          />
          {/* items-start + the field label's type: a hex error takes its own
              space instead of dropping the color well out of line. */}
          <div className="flex items-start gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="px-1 text-footnote font-medium text-label-2">
                Custom
              </span>
              <input
                type="color"
                aria-label="Pick a custom color"
                value={valid ?? "#007aff"}
                onChange={(e) => pick(e.currentTarget.value)}
                className="h-11 w-14 cursor-pointer rounded-control border-0 bg-transparent p-0"
              />
            </label>
            <div className="flex-1">
              <FText
                name="hex"
                label="Hex"
                value={hexText}
                placeholder="#0A84FF"
                maxLength={7}
                autoCapitalize="off"
                spellCheck={false}
                error={hexErr}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setHexText(v);
                  if (v === "" || normalizeHex(v)) setAccent(v);
                }}
              />
            </div>
            {valid && (
              <Button
                variant="plain"
                size="sm"
                icon={<RotateCcw aria-hidden size={16} />}
                onClick={() => pick("")}
              >
                Default
              </Button>
            )}
          </div>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: the Toggle input is inside the label */}
          <label className="flex min-h-11 items-center justify-between gap-3">
            <span>
              <span className="block text-body">Preview across the app</span>
              <span className="block text-footnote text-label-2">
                Try the color everywhere before saving.
              </span>
            </span>
            <Toggle
              checked={livePreview}
              onChange={(e) => setLivePreview(e.currentTarget.checked)}
              label="Preview across the app"
            />
          </label>
        </FieldCard>

        <section aria-label="Preview">
          <h2 className="px-4 pb-2 text-subhead font-semibold text-label-2">
            Preview
          </h2>
          <BrandPreview hex={valid} />
        </section>

        {report && (
          <ListSection
            header="Readability"
            footer={
              report.adjusted.light || report.adjusted.dark
                ? "Links use a slightly adjusted shade of your color so they pass WCAG AA (4.5:1)."
                : "Your color passes WCAG AA as-is."
            }
          >
            {report.lines.map((l) => (
              <div
                key={l.key}
                className="list-row flex min-h-11 items-center gap-3 px-4 py-2"
              >
                <span
                  aria-hidden
                  className="size-5 shrink-0 rounded-full shadow-[0_0_0_0.5px_var(--sep)]"
                  style={{ background: l.color }}
                />
                <span className="flex-1 text-body">{l.label}</span>
                <span className="num text-subhead text-label-2">
                  {l.ratio.toFixed(1)}:1
                </span>
                {l.pass ? (
                  <CircleCheck
                    aria-label="Passes"
                    size={20}
                    className="text-[var(--sys-green)]"
                  />
                ) : (
                  <CircleAlert
                    aria-label={`Below ${l.min}:1`}
                    size={20}
                    className="text-[var(--sys-orange)]"
                  />
                )}
              </div>
            ))}
          </ListSection>
        )}

        <FieldCard header="Logo">
          <ImageUpload
            kind="logo"
            label="Logo"
            hint="Shown on invoices, estimates and customer pages. Square or wide PNG works best."
            currentUrl={logoUrl}
            onSave={(mediaId) => setLogoAction({ variant: "light", mediaId })}
          />
          <ImageUpload
            kind="logo"
            label="Logo for dark mode"
            hint="Optional light version for dark backgrounds."
            dark
            currentUrl={logoDarkUrl}
            onSave={(mediaId) => setLogoAction({ variant: "dark", mediaId })}
          />
        </FieldCard>

        <FieldCard
          header="App"
          footer="The name on the home-screen icon and the browser tab. Defaults to your business name."
        >
          <FText
            name="appName"
            label="App name"
            value={appName}
            onChange={(e) => setAppName(e.currentTarget.value)}
            placeholder={companyName}
            maxLength={40}
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-subhead font-medium text-label-2">
              Default appearance
            </span>
            <SegmentedControl
              label="Default appearance"
              value={theme}
              onChange={setTheme}
              segments={[
                { value: "system", label: "Automatic" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
            />
            <span className="text-footnote text-label-2">
              Each person can still choose their own in Profile.
            </span>
          </div>
        </FieldCard>

        <section aria-label="Invoice header">
          <h2 className="px-4 pb-2 text-subhead font-semibold text-label-2">
            Invoice header
          </h2>
          <div className="flex flex-col gap-4 rounded-card bg-card p-4">
            <SegmentedControl
              label="Invoice header style"
              value={header}
              onChange={setHeader}
              segments={[
                { value: "standard", label: "Standard" },
                { value: "centered", label: "Centered" },
                { value: "minimal", label: "Minimal" },
              ]}
            />
            <InvoiceHeaderPreview
              style={header}
              name={appName || companyName}
              logoUrl={logoUrl}
            />
          </div>
        </section>

        <StickySave pending={f.pending} />
      </form>
    </FormErrors>
  );
}

function BrandPreview({ hex }: { hex: string | null }) {
  const r = contrastReport(hex);
  const style = r
    ? ({
        "--accent": r.accent,
        "--on-accent": r.onAccent,
      } as CSSProperties)
    : undefined;
  return (
    <div style={style} className="flex flex-col gap-4 rounded-card bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex min-h-11 items-center rounded-control bg-accent-fill px-5 text-body font-semibold text-on-accent">
          Collect payment
        </span>
        <span className="inline-flex min-h-11 items-center rounded-control bg-accent/15 px-5 text-body font-semibold text-accent-text">
          Send estimate
        </span>
        <Toggle defaultChecked aria-hidden tabIndex={-1} />
      </div>
      <p className="text-body">
        Job J-1042 is <span className="text-accent-text">confirmed</span> for
        tomorrow, 9–11 AM.
      </p>
      <div className="flex gap-2">
        {(["Today", "Jobs", "Pay"] as const).map((t, i) => (
          <span
            key={t}
            className={cx(
              "rounded-pill px-3 py-1 text-footnote font-semibold",
              i === 0
                ? "bg-accent-fill text-on-accent"
                : "bg-fill-2 text-label-2",
            )}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function InvoiceHeaderPreview({
  style,
  name,
  logoUrl,
}: {
  style: HeaderStyle;
  name: string;
  logoUrl: string | null;
}) {
  const logo = logoUrl ? (
    // biome-ignore lint/performance/noImgElement: tiny preview of the uploaded logo
    <img src={logoUrl} alt="" className="h-8 w-auto object-contain" />
  ) : (
    <span
      aria-hidden
      className="flex size-8 items-center justify-center rounded-[8px] bg-accent-fill text-footnote font-bold text-on-accent"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
  return (
    <div
      aria-hidden
      className="rounded-control border border-[var(--sep)] bg-white p-4 text-[#111]"
    >
      {style === "centered" ? (
        <div className="flex flex-col items-center gap-1 text-center">
          {logo}
          <div className="text-subhead font-semibold">{name}</div>
          <div className="text-caption text-[#666]">INVOICE INV-1042</div>
        </div>
      ) : style === "minimal" ? (
        <div className="flex items-baseline justify-between border-b border-[#ddd] pb-2">
          <div className="text-subhead font-semibold">{name}</div>
          <div className="text-caption text-[#666]">Invoice INV-1042</div>
        </div>
      ) : (
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            {logo}
            <div>
              <div className="text-subhead font-semibold">{name}</div>
              <div className="text-caption text-[#666]">
                (512) 555-0100 · Austin, TX
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-subhead font-bold">INVOICE</div>
            <div className="text-caption text-[#666]">INV-1042</div>
          </div>
        </div>
      )}
    </div>
  );
}
