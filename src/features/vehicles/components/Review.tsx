import { FileText, Sparkles, TriangleAlert } from "lucide-react";
import { Pill } from "@/ui/components/StatusPill";
import { cx } from "@/ui/cx";
import type { ReviewItem } from "../review";

// Server-rendered review pieces for vehicle approvals: a one-line Row and a
// Detail with the evidence full-size next to typed vs AI values (SPEC M17).

const TYPE_LABEL: Record<string, string> = {
  odometer: "Odometer",
  fuel: "Fuel",
  service: "Service",
  document: "Document",
  inspection: "Inspection",
  trip: "Trip",
};

export function ConfidenceChip({ value }: { value: number | null }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  const tone = value >= 0.85 ? "green" : value >= 0.6 ? "orange" : "red";
  return (
    <Pill tone={tone} size="sm">
      AI {pct}% sure
    </Pill>
  );
}

export function ReviewRow({ item }: { item: ReviewItem }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="truncate text-body">
        <span className="font-semibold">{item.vehicleName}</span>
        <span className="text-label-2"> · {item.headline}</span>
      </span>
      {item.flags.length > 0 ? (
        <Pill tone="red" size="sm">
          {item.flags.length} flag{item.flags.length === 1 ? "" : "s"}
        </Pill>
      ) : item.clean ? (
        <Pill tone="green" size="sm">
          Clean
        </Pill>
      ) : null}
    </div>
  );
}

export function ReviewDetail({ item }: { item: ReviewItem }) {
  const hasAi = item.fields.some((f) => f.ai != null);
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        {item.images.length === 0 ? (
          <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-card bg-fill-2 text-footnote text-label-2">
            <TriangleAlert aria-hidden size={22} />
            No photo or document attached
          </div>
        ) : (
          item.images.map((img) =>
            img.pdf ? (
              <a
                key={img.id}
                href={img.url}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-11 items-center gap-2 rounded-card bg-fill-2 px-4 py-3 text-accent-text"
              >
                <FileText aria-hidden size={20} /> Open PDF
              </a>
            ) : (
              <a
                key={img.id}
                href={img.url}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-card bg-fill-2"
                aria-label="Open the full-size image"
              >
                {/* biome-ignore lint/performance/noImgElement: signed storage URL, pre-sized */}
                <img
                  src={img.url}
                  alt={`${TYPE_LABEL[item.type] ?? "Log"} evidence`}
                  className="max-h-[420px] w-full object-contain"
                  decoding="async"
                  loading="lazy"
                />
              </a>
            ),
          )
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone="indigo" size="sm" dot={false}>
            {TYPE_LABEL[item.type] ?? item.type}
          </Pill>
          {item.aiStatus === "pending" && (
            <Pill tone="blue" size="sm">
              AI check running
            </Pill>
          )}
          {item.aiStatus === "skipped" && (
            <Pill tone="gray" size="sm">
              AI unavailable
            </Pill>
          )}
          <ConfidenceChip value={item.aiConfidence} />
        </div>
        <div className="list-card overflow-hidden">
          <table className="w-full text-subhead">
            <caption className="sr-only">
              Typed values{hasAi ? " vs AI-read values" : ""}
            </caption>
            <thead>
              <tr className="text-footnote text-label-2">
                <th scope="col" className="px-3 py-2 text-left font-normal">
                  Field
                </th>
                <th scope="col" className="px-3 py-2 text-left font-normal">
                  Typed
                </th>
                {hasAi && (
                  <th scope="col" className="px-3 py-2 text-left font-normal">
                    <span className="inline-flex items-center gap-1">
                      <Sparkles aria-hidden size={13} /> AI read
                    </span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {item.fields.map((f) => (
                <tr key={f.label} className="border-t border-[var(--sep)]">
                  <th
                    scope="row"
                    className="px-3 py-2 text-left font-normal text-label-2"
                  >
                    {f.label}
                  </th>
                  <td
                    className={cx(
                      "num px-3 py-2",
                      f.mismatch && "font-semibold text-danger",
                    )}
                  >
                    {f.typed}
                  </td>
                  {hasAi && (
                    <td className="num px-3 py-2 text-label-2">
                      {f.ai ?? "—"}
                    </td>
                  )}
                </tr>
              ))}
              {item.previous && (
                <tr className="border-t border-[var(--sep)]">
                  <th
                    scope="row"
                    className="px-3 py-2 text-left font-normal text-label-2"
                  >
                    Previous approved
                  </th>
                  <td className="num px-3 py-2" colSpan={hasAi ? 2 : 1}>
                    {item.previous}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {(item.flags.length > 0 || item.missing.length > 0) && (
          <ul
            className="flex flex-wrap gap-1.5"
            aria-label="Why this needs review"
          >
            {item.flags.map((f) => (
              <li key={f.code}>
                <Pill tone="red" size="sm">
                  {f.label}
                </Pill>
              </li>
            ))}
            {item.missing.map((m) => (
              <li key={m.code}>
                <Pill tone="orange" size="sm">
                  {m.label}
                </Pill>
              </li>
            ))}
          </ul>
        )}
        <p className="text-footnote text-label-2">
          {item.submittedBy ? `Submitted by ${item.submittedBy}` : "Submitted"}{" "}
          · {item.submittedAt}
        </p>
      </div>
    </div>
  );
}
