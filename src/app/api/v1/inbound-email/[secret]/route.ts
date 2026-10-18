import { NextResponse } from "next/server";

// POST /api/v1/inbound-email/[secret] — parsed marketplace emails from a Cloudflare
// Email Worker. Later (SPEC M04): not built in v1.
export function POST() {
  return NextResponse.json(
    {
      error: "not_implemented",
      message: "Inbound email parsing is planned for a later release.",
    },
    { status: 501 },
  );
}
