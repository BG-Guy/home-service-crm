"use client";

import { ArrowDown, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { Avatar } from "@/ui/components/Avatar";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { SearchField } from "@/ui/components/SearchField";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Spinner } from "@/ui/components/Spinner";
import { toast } from "@/ui/components/Toast";
import { NAV_FORWARD } from "@/ui/motion/PageTransition";
import {
  type MergeSide,
  mergeCustomers,
  previewMerge,
  searchMergeCandidates,
} from "../actions";
import type { PickerCustomer } from "../contracts";
import { CUSTOMER_TYPE_LABEL } from "./FlagChips";

const CHANNEL_LABEL: Record<string, string> = {
  sms: "Text message",
  call: "Phone call",
  email: "Email",
  whatsapp: "WhatsApp",
};

/** Human value for a merge field (formatted phones, labels instead of codes). */
function shown(key: string, v: string | null | undefined): string | null {
  if (!v) return null;
  if (key === "phone" || key === "phoneAlt") return formatPhoneDisplay(v);
  if (key === "type") return CUSTOMER_TYPE_LABEL[v] ?? v;
  if (key === "preferredChannel") return CHANNEL_LABEL[v] ?? v;
  return v;
}

const n = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** Linked records: the side with more history is the better default survivor. */
const weight = (side: MergeSide) =>
  side.counts.jobs * 4 +
  side.counts.invoices * 4 +
  side.counts.leads +
  side.counts.props +
  Object.values(side.values).filter(Boolean).length / 100;

const FIELDS: { key: string; label: string }[] = [
  { key: "displayName", label: "Display name" },
  { key: "type", label: "Type" },
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "companyName", label: "Company" },
  { key: "phone", label: "Mobile" },
  { key: "phoneAlt", label: "Other phone" },
  { key: "email", label: "Email" },
  { key: "preferredChannel", label: "Prefers" },
  { key: "notes", label: "Notes" },
];

/** Merge tool: pick the duplicate, choose surviving values, confirm. */
export function MergeTool({
  current,
}: {
  current: { id: string; displayName: string };
}) {
  const router = useRouter();
  const [results, setResults] = useState<PickerCustomer[] | null>(null);
  const [other, setOther] = useState<PickerCustomer | null>(null);
  const [preview, setPreview] = useState<{ a: MergeSide; b: MergeSide } | null>(
    null,
  );
  const [keep, setKeep] = useState<"current" | "other">("current");
  const [pick, setPick] = useState<Record<string, "survivor" | "merged">>({});
  const [pending, start] = useTransition();

  useEffect(() => {
    void searchMergeCandidates(
      current.id,
      current.displayName.split(" ")[0] ?? "",
    ).then(setResults);
  }, [current.id, current.displayName]);

  useEffect(() => {
    if (!other) return;
    setPreview(null);
    setPick({});
    void previewMerge(current.id, other.id).then((p) => {
      setPreview(p);
      // Default to keeping the record with more history (QA2 T2-18), not
      // whichever page the merge started from; ties keep the older one.
      if (p) {
        const wa = weight(p.a);
        const wb = weight(p.b);
        setKeep(
          wb > wa || (wb === wa && p.b.createdAt < p.a.createdAt)
            ? "other"
            : "current",
        );
      }
    });
  }, [other, current.id]);

  if (!other)
    return (
      <div className="flex flex-col gap-4">
        <p className="px-1 text-subhead text-label-2">
          Find the duplicate of{" "}
          <strong className="text-label">{current.displayName}</strong>. Jobs,
          invoices, payments, messages, photos and notes move to the record you
          keep.
        </p>
        <SearchField
          placeholder="Name, phone, email or street"
          onSearch={(q) =>
            void searchMergeCandidates(current.id, q).then(setResults)
          }
          showCancel={false}
        />
        {results == null ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : results.length === 0 ? (
          <div className="list-card">
            <EmptyState
              compact
              title="No other customers found"
              message="Try a phone number or street."
            />
          </div>
        ) : (
          <ListSection header="Possible duplicates">
            {results.map((r) => (
              <ListRow
                key={r.id}
                leading={<Avatar name={r.displayName} seed={r.id} size={34} />}
                title={r.displayName}
                subtitle={[r.subtitle, r.properties[0]?.addressLine]
                  .filter(Boolean)
                  .join(" · ")}
                onClick={() => setOther(r)}
              />
            ))}
          </ListSection>
        )}
      </div>
    );

  if (!preview)
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );

  const survivor = keep === "current" ? preview.a : preview.b;
  const merged = keep === "current" ? preview.b : preview.a;
  const differing = FIELDS.filter(
    (f) =>
      (survivor.values[f.key] ?? "") !== (merged.values[f.key] ?? "") &&
      merged.values[f.key],
  );
  const firstA = preview.a.displayName.split(" ")[0] ?? "";
  const firstB = preview.b.displayName.split(" ")[0] ?? "";
  const sameName = firstA.toLowerCase() === firstB.toLowerCase();
  const choose = (k: string) =>
    pick[k] ?? (survivor.values[k] ? "survivor" : "merged");

  const run = () =>
    start(async () => {
      const r = await mergeCustomers({
        survivorId: survivor.id,
        mergedId: merged.id,
        pick: Object.fromEntries(differing.map((f) => [f.key, choose(f.key)])),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Customers merged");
      router.replace(`/customers/${survivor.id}`, {
        transitionTypes: NAV_FORWARD,
      });
    });

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <SegmentedControl
        label="Record to keep"
        value={keep}
        onChange={(v) => {
          setKeep(v);
          setPick({});
        }}
        segments={[
          {
            value: "current",
            label: sameName ? "Keep this one" : `Keep ${firstA}`,
          },
          {
            value: "other",
            label: sameName ? "Keep the other" : `Keep ${firstB}`,
          },
        ]}
      />
      <div className="flex flex-col items-center gap-1 text-center">
        <SideCard side={merged} muted />
        <ArrowDown size={20} className="text-label-3" aria-hidden />
        <SideCard side={survivor} />
      </div>
      {differing.length > 0 ? (
        <ListSection
          header="Choose the values to keep"
          footer="Phones that aren't kept are saved as the other phone when there's room."
        >
          {differing.flatMap((f) => [
            <ListRow
              key={`${f.key}-s`}
              title={
                shown(f.key, survivor.values[f.key]) || (
                  <span className="text-label-3">Empty</span>
                )
              }
              subtitle={`${f.label} · ${survivor.displayName}`}
              accessory={choose(f.key) === "survivor" ? "check" : "none"}
              onClick={() => setPick((p) => ({ ...p, [f.key]: "survivor" }))}
            />,
            <ListRow
              key={`${f.key}-m`}
              title={shown(f.key, merged.values[f.key])}
              subtitle={`${f.label} · ${merged.displayName}`}
              accessory={choose(f.key) === "merged" ? "check" : "none"}
              onClick={() => setPick((p) => ({ ...p, [f.key]: "merged" }))}
            />,
          ])}
        </ListSection>
      ) : (
        <Banner tone="success" icon={<Check size={18} />}>
          No conflicting fields — everything combines cleanly.
        </Banner>
      )}
      <Banner tone="warning" title="This can't be undone">
        {merged.displayName} becomes a redirect to {survivor.displayName}. Flags
        and tags are combined.
      </Banner>
      <div className="flex gap-2">
        <Button variant="gray" fullWidth onClick={() => setOther(null)}>
          Back
        </Button>
        <Button variant="destructive" fullWidth loading={pending} onClick={run}>
          Merge
        </Button>
      </div>
    </div>
  );
}

function SideCard({ side, muted }: { side: MergeSide; muted?: boolean }) {
  const c = side.counts;
  return (
    <div
      className={`list-card flex w-full items-center gap-3 px-4 py-3 text-left ${muted ? "opacity-70" : ""}`}
    >
      <Avatar name={side.displayName} seed={side.id} size={40} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-headline">{side.displayName}</div>
        <div className="truncate text-footnote text-label-2">
          {[
            n(c.jobs, "job", "jobs"),
            n(c.invoices, "invoice", "invoices"),
            n(c.props, "address", "addresses"),
            n(c.leads, "lead", "leads"),
          ].join(" · ")}
        </div>
      </div>
      <span className="text-footnote font-semibold text-label-2">
        {muted ? "Merged" : "Kept"}
      </span>
    </div>
  );
}
