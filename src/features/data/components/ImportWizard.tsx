"use client";

import { FileUp, Upload } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { Select } from "@/ui/components/Field";
import { ListRow, ListSection } from "@/ui/components/List";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { type ImportPreview, previewImport, runImport } from "../actions";
import type { ImportKind, ImportMapping } from "../import-fields";

const KIND_LABEL: Record<ImportKind, string> = {
  customers: "Customers",
  pricebook: "Price book",
  jobs: "Past jobs",
};
const KIND_HINT: Record<ImportKind, string> = {
  customers:
    "One row per customer. Matching phone or email updates the existing customer instead of duplicating.",
  pricebook:
    "One row per service or part. Matching SKU (or name) updates the item.",
  jobs: "Completed jobs for history and lifetime value (no invoices are created). Customers are matched or added.",
};

type Step = "pick" | "map" | "done";

/** CSV import: choose type → upload → column mapping → dry-run preview → import. */
export function ImportWizard() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ImportKind>("customers");
  const [step, setStep] = useState<Step>("pick");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep("pick");
    setCsv("");
    setFileName("");
    setPreview(null);
    setMapping({});
    setResult(null);
  };

  const load = (file: File) => {
    if (file.size > 1_900_000)
      return void toast.error("That file is over 2 MB", {
        message: "Split it into smaller files.",
      });
    setFileName(file.name);
    file.text().then((text) => {
      setCsv(text);
      start(async () => {
        const r = await previewImport({ kind, csv: text });
        if (!r.ok) return void toast.error(r.error);
        setPreview(r.data);
        setMapping(r.data.mapping);
        setStep("map");
      });
    });
  };

  const remap = (next: ImportMapping) => {
    setMapping(next);
    start(async () => {
      const r = await previewImport({ kind, csv, mapping: next });
      if (r.ok) setPreview(r.data);
      else toast.error(r.error);
    });
  };

  const doImport = () =>
    start(async () => {
      const r = await runImport({ kind, csv, mapping });
      if (!r.ok) return void toast.error(r.error);
      setResult(r.data as unknown as Record<string, number>);
      setStep("done");
      toast.success("Import finished");
    });

  return (
    <>
      <ListSection
        header="Import"
        footer="CSV files from a spreadsheet or your old software (Jobber, Housecall Pro…). You'll see a preview before anything is saved."
      >
        <ListRow
          icon={<Upload size={17} />}
          iconTone="green"
          title="Import from a CSV file"
          onClick={() => setOpen(true)}
          accessory="chevron"
        />
      </ListSection>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        onClosed={reset}
        title={
          step === "done"
            ? "Imported"
            : `Import ${KIND_LABEL[kind].toLowerCase()}`
        }
        detents={["large"]}
        dirty={step === "map"}
        leading={
          <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
            {step === "done" ? "Close" : "Cancel"}
          </Button>
        }
        trailing={
          step === "map" ? (
            <Button
              variant="plain"
              size="sm"
              className="font-semibold"
              disabled={!preview?.validCount}
              loading={pending}
              onClick={doImport}
            >
              Import {preview?.validCount ?? 0}
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-[var(--section-gap)] pb-8">
          {step === "pick" && (
            <>
              <SegmentedControl
                label="What are you importing?"
                segments={(Object.keys(KIND_LABEL) as ImportKind[]).map(
                  (k) => ({
                    value: k,
                    label: KIND_LABEL[k],
                  }),
                )}
                value={kind}
                onChange={setKind}
              />
              <p className="px-1 text-subhead text-label-2">
                {KIND_HINT[kind]}
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  if (f) load(f);
                  e.currentTarget.value = "";
                }}
              />
              <Button
                variant="filled"
                size="lg"
                fullWidth
                loading={pending}
                icon={<FileUp size={18} aria-hidden />}
                onClick={() => fileRef.current?.click()}
              >
                Choose CSV file
              </Button>
              <p className="px-1 text-footnote text-label-2">
                The first row must hold the column names. Up to 10,000 rows and
                2 MB per file.
              </p>
            </>
          )}

          {step === "map" && preview && (
            <>
              <Banner
                tone={preview.errors.length ? "warning" : "success"}
                title={`${preview.validCount} of ${preview.total} rows ready`}
              >
                {fileName}
                {preview.duplicates
                  ? ` · ${preview.duplicates} match existing records and will be updated, not duplicated`
                  : ""}
              </Banner>
              <ListSection
                header="Match your columns"
                footer="We guessed from the column names. Fix anything that looks off; the preview updates."
              >
                {preview.fields.map((f) => (
                  <div
                    key={f.key}
                    className="list-row grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-center gap-3 px-4 py-1.5"
                  >
                    <span className="text-body">
                      {f.label}
                      {f.required ? " *" : ""}
                    </span>
                    <Select
                      label={f.label}
                      hideLabel
                      value={mapping[f.key] ?? ""}
                      onChange={(e) =>
                        remap({
                          ...mapping,
                          [f.key]: e.currentTarget.value || null,
                        })
                      }
                      options={[
                        { value: "", label: "— Skip —" },
                        ...preview.headers.map((h) => ({ value: h, label: h })),
                      ]}
                    />
                  </div>
                ))}
              </ListSection>
              {preview.errors.length > 0 && (
                <ListSection
                  header={`Rows that will be skipped (${preview.errors.length})`}
                >
                  {preview.errors.slice(0, 20).map((e) => (
                    <ListRow
                      key={`${e.row}-${e.error}`}
                      title={`Row ${e.row}`}
                      subtitle={e.error}
                    />
                  ))}
                </ListSection>
              )}
              {preview.sample[0] && (
                <ListSection header="First row">
                  {Object.entries(preview.sample[0])
                    .slice(0, 12)
                    .map(([k, v]) => (
                      <ListRow key={k} title={k} detail={v || "—"} />
                    ))}
                </ListSection>
              )}
            </>
          )}

          {step === "done" && result && (
            <ListSection>
              {Object.entries(result).map(([k, v]) => (
                <ListRow
                  key={k}
                  title={k
                    .replace(/_/g, " ")
                    .replace(/^\w/, (c) => c.toUpperCase())}
                  detail={String(v)}
                />
              ))}
            </ListSection>
          )}
        </div>
      </Sheet>
    </>
  );
}
