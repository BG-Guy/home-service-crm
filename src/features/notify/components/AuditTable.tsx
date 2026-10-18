"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { formatDateTime } from "@/lib/time";
import { cx } from "@/ui/cx";
import type { AuditRowDTO } from "../contracts";

function diffKeys(before: unknown, after: unknown): string[] {
  const b = (before && typeof before === "object" ? before : {}) as Record<
    string,
    unknown
  >;
  const a = (after && typeof after === "object" ? after : {}) as Record<
    string,
    unknown
  >;
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  return [...keys].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
}

function show(v: unknown): string {
  if (v === undefined) return "—";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/** Audit rows with an expandable before/after diff. Read-only (append-only table). */
export function AuditTable({
  rows,
  timeZone,
}: {
  rows: AuditRowDTO[];
  timeZone: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <ul className="overflow-hidden rounded-card bg-card shadow-card">
      {rows.map((r) => {
        const isOpen = open === r.id;
        const keys = diffKeys(r.before, r.after);
        const b = (r.before ?? {}) as Record<string, unknown>;
        const a = (r.after ?? {}) as Record<string, unknown>;
        return (
          <li key={r.id} className="border-b-[0.5px] border-sep last:border-0">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : r.id)}
              className="flex min-h-11 w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-fill-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-subhead text-label">
                  {r.action}
                </p>
                <p className="truncate text-footnote text-label-2">
                  {r.actor}
                  {r.entityType ? ` · ${r.entityType}` : ""}
                  {r.entityId ? ` ${r.entityId.slice(0, 8)}` : ""}
                  {r.ip ? ` · ${r.ip}` : ""}
                </p>
              </div>
              <time
                className="num shrink-0 text-footnote text-label-2"
                dateTime={r.at}
              >
                {formatDateTime(r.at, timeZone)}
              </time>
              <ChevronDown
                aria-hidden
                size={16}
                className={cx(
                  "mt-0.5 shrink-0 text-label-3 transition-transform duration-200 ease-[var(--ease-spring)]",
                  isOpen && "rotate-180",
                )}
              />
            </button>
            {isOpen && (
              <div className="px-4 pb-3">
                {keys.length === 0 ? (
                  <p className="text-footnote text-label-2">
                    No field changes recorded.
                  </p>
                ) : (
                  <table className="w-full table-fixed text-footnote">
                    <thead className="text-left text-label-2">
                      <tr>
                        <th className="w-1/4 py-1 font-medium">Field</th>
                        <th className="py-1 font-medium">Before</th>
                        <th className="py-1 font-medium">After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {keys.map((k) => (
                        <tr key={k} className="align-top">
                          <td className="break-words py-1 pr-2 font-mono">
                            {k}
                          </td>
                          <td className="break-words py-1 pr-2 text-danger">
                            {show(b[k])}
                          </td>
                          <td className="break-words py-1 text-success">
                            {show(a[k])}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
