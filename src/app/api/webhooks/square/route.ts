import { NextResponse } from "next/server";

// Square webhooks are Later (SPEC M09 Later list). The route exists so the URL is stable.
export const dynamic = "force-dynamic";

export function POST(): Response {
  return NextResponse.json(
    {
      error: "not_implemented",
      message: "Square payments are not available yet.",
    },
    { status: 501 },
  );
}
