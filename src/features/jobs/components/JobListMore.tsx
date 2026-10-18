"use client";

import { useState, useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";
import type { JobListFilters, JobListItem } from "../types";
import { JobRow } from "./JobRow";
import { fetchJobsPage } from "./list-reads";

/** Appends further pages of the jobs list (server cursor, SPEC §14 rule 8). */
export function JobListMore({
  filters,
  cursor,
  tz,
}: {
  filters: JobListFilters;
  cursor: string;
  tz: string;
}) {
  const [items, setItems] = useState<JobListItem[]>([]);
  const [next, setNext] = useState<string | null>(cursor);
  const [pending, start] = useTransition();
  const load = () =>
    start(async () => {
      const r = await fetchJobsPage({ ...filters, cursor: next });
      if (!r.ok || !r.data) {
        toast.error(r.ok ? "Couldn't load more jobs." : r.error);
        return;
      }
      setItems((prev) => [...prev, ...(r.data?.items ?? [])]);
      setNext(r.data.nextCursor);
    });
  return (
    <div className="flex flex-col gap-4">
      {items.length > 0 && (
        <ul className="list-card">
          {items.map((j) => (
            <li key={j.id}>
              <JobRow job={j} tz={tz} />
            </li>
          ))}
        </ul>
      )}
      {next && (
        <Button variant="gray" fullWidth loading={pending} onClick={load}>
          Load more
        </Button>
      )}
    </div>
  );
}
