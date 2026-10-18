import { NextResponse } from "next/server";
import { leadJsonSchema } from "@/features/leads/intake/schema";

// GET /api/v1/leads/schema — accepted fields and aliases for integrators (SPEC §8.1).
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(leadJsonSchema(), {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
