import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { flattenZodError } from "./action";
import { clientIpFromHeaders } from "./client-ip";
import {
  AppError,
  ConfigError,
  FeatureDisabledError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
  ValidationError,
} from "./errors";

// Route-handler helpers: map domain errors to HTTP responses (never leak internals).

export { clientIpFromHeaders } from "./client-ip";

export function jsonError(err: unknown): NextResponse {
  if (err instanceof z.ZodError)
    return NextResponse.json(
      { error: "invalid_request", fieldErrors: flattenZodError(err) },
      { status: 400 },
    );
  if (err instanceof ValidationError)
    return NextResponse.json(
      { error: err.userMessage, fieldErrors: err.fieldErrors },
      { status: 400 },
    );
  if (err instanceof UnauthorizedError)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (err instanceof ForbiddenError || err instanceof FeatureDisabledError) {
    return NextResponse.json(
      { error: err.code, message: err.userMessage },
      { status: 403 },
    );
  }
  if (err instanceof NotFoundError)
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (err instanceof RateLimitedError) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(err.retryAfterSec) } },
    );
  }
  if (err instanceof ConfigError) {
    console.error("[api] server misconfigured:", err.message);
    return NextResponse.json(
      { error: err.code, message: err.userMessage },
      { status: 503 },
    );
  }
  if (err instanceof AppError)
    return NextResponse.json(
      { error: err.code, message: err.userMessage },
      { status: 409 },
    );
  console.error("[api] unexpected error:", err);
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}

/** Parse a JSON body with a size cap. */
export async function readJson<T>(
  req: Request,
  schema: z.ZodType<T>,
  maxBytes = 64 * 1024,
): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes)
    throw new ValidationError({ _: ["Request body too large."] });
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new ValidationError({ _: ["Invalid JSON."] });
  }
  return schema.parse(raw);
}

/** Client IP under the TRUST_PROXY setting (src/lib/client-ip.ts), never the spoofable leftmost XFF. */
export function clientIp(req: Request): string | null {
  return clientIpFromHeaders(req.headers);
}
