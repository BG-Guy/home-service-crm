import "server-only";
import { sql } from "drizzle-orm";
import { execRows } from "@/db";
import type { SessionUser } from "@/lib/types";

// Read side for /settings/data.

export interface ExportItem {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  bytes: number | null;
  rows: number | null;
  requestedBy: string | null;
  error: string | null;
  date: string | null;
}

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

export async function listExports(
  viewer: SessionUser,
  kind: "full" | "backup",
  limit = 10,
): Promise<ExportItem[]> {
  if (!viewer.perms.has("data.export") && !viewer.perms.has("data.import"))
    return [];
  const rows = await execRows<{
    id: string;
    kind: string;
    status: string;
    created_at: Date | string;
    completed_at: Date | string | null;
    expires_at: Date | string | null;
    params: Record<string, unknown> | null;
    requested_by: string | null;
  }>(sql`
    select e.id, e.kind, e.status, e.created_at, e.completed_at, e.expires_at, e.params,
      u.name as requested_by
    from exports e left join users u on u.id = e.requested_by
    where ${kind === "backup" ? sql`e.kind = 'backup'` : sql`e.kind = 'full'`}
    order by e.created_at desc limit ${limit}`);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    createdAt: iso(r.created_at) as string,
    completedAt: iso(r.completed_at),
    expiresAt: iso(r.expires_at),
    bytes: typeof r.params?.bytes === "number" ? r.params.bytes : null,
    rows: typeof r.params?.rows === "number" ? r.params.rows : null,
    requestedBy: r.requested_by,
    error: typeof r.params?.error === "string" ? r.params.error : null,
    date: typeof r.params?.date === "string" ? r.params.date : null,
  }));
}
