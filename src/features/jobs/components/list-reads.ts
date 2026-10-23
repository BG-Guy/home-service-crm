"use server";

import type { ActionResult } from "@/lib/types";
import { getJobDetail, listJobs } from "../queries";
import type { JobListFilters, JobListItem } from "../types";

/** What the job card's peek shows (the key facts; the full page has the rest). */
export interface JobPeek {
  id: string;
  number: string;
  title: string;
  status: JobListItem["status"];
  paymentStatus: JobListItem["paymentStatus"];
  priority: JobListItem["priority"];
  afterHours: boolean;
  serviceTypeName: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  customerName: string;
  address: string;
  addressMasked: boolean;
  customerNotes: string | null;
  description: string | null;
  assignees: string[];
  isCallback: boolean;
  callbackReason: string | null;
  holdReason: string | null;
  confirmed: boolean;
  rescheduleRequested: boolean;
  riskBand: string | null;
  checklist: { done: number; total: number };
}

/** The peek's details, loaded on open (same access rules as the job page). */
export async function fetchJobPeek(
  jobId: string,
): Promise<ActionResult<JobPeek>> {
  try {
    const j = await getJobDetail(String(jobId ?? ""));
    if (!j) return { ok: false, error: "This job isn't available." };
    return {
      ok: true,
      data: {
        id: j.id,
        number: j.number,
        title: j.title,
        status: j.status,
        paymentStatus: j.paymentStatus,
        priority: j.priority,
        afterHours: j.afterHours,
        serviceTypeName: j.serviceTypeName,
        windowStart: j.windowStart ?? j.scheduledStart,
        windowEnd: j.windowEnd ?? j.scheduledEnd,
        customerName: j.customerName,
        address: j.addressFull,
        addressMasked: j.addressMasked,
        customerNotes: j.customerNotes,
        description: j.description,
        assignees: j.assignees.map((a) => a.name),
        isCallback: j.isCallback,
        callbackReason: j.callbackReason,
        holdReason: j.holdReason,
        confirmed: !!j.confirmedAt,
        rescheduleRequested: !!j.rescheduleRequestedAt,
        riskBand: j.riskBand,
        checklist: {
          done: j.checklist.filter((c) => c.answeredAt != null).length,
          total: j.checklist.length,
        },
      },
    };
  } catch {
    return { ok: false, error: "Couldn't load this job." };
  }
}

/** Next page for the client "Load more" button (same scope rules as the page). */
export async function fetchJobsPage(
  f: JobListFilters,
): Promise<ActionResult<{ items: JobListItem[]; nextCursor: string | null }>> {
  try {
    const r = await listJobs(f);
    return { ok: true, data: { items: r.items, nextCursor: r.nextCursor } };
  } catch {
    return { ok: false, error: "Couldn't load more jobs." };
  }
}
