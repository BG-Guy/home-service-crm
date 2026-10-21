// Assign hub URLs (pure, client-safe): /dispatch?date=&job=&tech=.

export interface HubQuery {
  date: string;
  job: string | null;
}

export function hubHref(
  q: HubQuery,
  tech?: string | null,
  date?: string,
): string {
  const p = new URLSearchParams();
  p.set("date", date ?? q.date);
  if (q.job) p.set("job", q.job);
  if (tech) p.set("tech", tech);
  return `/dispatch?${p.toString()}`;
}

/** Entry link from a job (job page, assign sheet): open the hub on that job. */
export function hubHrefForJob(jobId: string, date?: string | null): string {
  const p = new URLSearchParams();
  if (date) p.set("date", date);
  p.set("job", jobId);
  return `/dispatch?${p.toString()}`;
}
