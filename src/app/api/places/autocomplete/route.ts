import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  type AddressLookup,
  getPlacesProvider,
  placesAttribution,
  suggestAddresses,
} from "@/adapters/places";
import { requireApiUser } from "@/lib/auth/current";
import { jsonError } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { findCompany } from "@/lib/settings";

// GET /api/places/autocomplete?q=… : address suggestions while staff type a street
// (src/ui/components/AddressAutocomplete.tsx). Signed-in session, 60 lookups/min per
// user, answers cached server-side (src/adapters/places) and privately in the browser.
// Never logs the typed address.
export const dynamic = "force-dynamic";

// 3–120 characters with at least one letter: "1", "12", "1234" (house numbers being
// typed) never reach the provider.
const Query = z.string().trim().min(3).max(120).regex(/\p{L}/u);

const PRIVATE = { "Cache-Control": "private, max-age=300" };
const NO_STORE = { "Cache-Control": "no-store" };

type Bias = { lat: number; lng: number } | null;
let biasMemo: { at: number; value: Bias } | null = null;

/** The company's location (ranks nearby addresses first), when the address has coordinates. */
async function companyBias(): Promise<Bias> {
  if (biasMemo && Date.now() - biasMemo.at < 10 * 60_000) return biasMemo.value;
  const a = (await findCompany().catch(() => null))?.address;
  const value =
    a && Number.isFinite(a.lat) && Number.isFinite(a.lng)
      ? { lat: a.lat as number, lng: a.lng as number }
      : null;
  biasMemo = { at: Date.now(), value };
  return value;
}

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const user = await requireApiUser();
    const provider = getPlacesProvider();
    const q = Query.safeParse(req.nextUrl.searchParams.get("q") ?? "");
    if (provider.id === "none" || !q.success) {
      const empty: AddressLookup = {
        suggestions: [],
        attribution: placesAttribution(provider.id),
        enabled: provider.id !== "none",
      };
      return NextResponse.json(empty, { headers: PRIVATE });
    }
    const limit = await rateLimit({
      key: `places:${user.id}`,
      limit: 60,
      windowSec: 60,
      store: "memory",
    });
    if (!limit.ok)
      return NextResponse.json(
        { error: "rate_limited", suggestions: [] },
        {
          status: 429,
          headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSec) },
        },
      );
    const result = await suggestAddresses({
      query: q.data,
      limit: 5,
      bias: await companyBias(),
    });
    return NextResponse.json(result, {
      headers: result.unavailable ? NO_STORE : PRIVATE,
    });
  } catch (err) {
    return jsonError(err);
  }
}
