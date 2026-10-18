import type { NextConfig } from "next";

// v1: cacheComponents / partialPrefetching / 'use cache' are intentionally OFF
// (authenticated routes render dynamically). See docs/SPEC.md §2 + lead-engineer amendment 3.
const prodDb = !!process.env.DATABASE_URL;

const nextConfig: NextConfig = {
  // PGlite ships WASM + data files that must be loaded from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite"],
  outputFileTracingExcludes: prodDb
    ? { "/*": ["node_modules/@electric-sql/pglite/**"] }
    : {},
  // SQL migrations are read at runtime (PGlite auto-migrate / DB_MIGRATE_ON_BOOT=1).
  outputFileTracingIncludes: { "/*": ["./drizzle/**/*"] },
  images: { unoptimized: true },
  // Lets a second `next dev` (QA, a parallel checkout) build into its own folder
  // inside the app, e.g. NEXT_DIST_DIR=.next-qa. Default: .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
    // Client router cache for dynamic pages (lead-engineer amendment 7): a
    // back/forward or repeat visit within 30 s reuses the rendered page, so push/pop
    // animate instantly. Mutations still refresh() + revalidatePath().
    staleTimes: { dynamic: 30 },
    // forbidden(): a denied page renders (app)/forbidden.tsx with a 403 and no
    // server error log; ForbiddenError carries the same digest (src/lib/errors.ts).
    authInterrupts: true,
  },
  poweredByHeader: false,
  output: process.env.STANDALONE ? "standalone" : undefined,
  async headers() {
    return [
      {
        // Baseline hardening. Referrer-Policy keeps magic-link tokens (/i/<token>…)
        // out of Referer headers sent to other origins (tiles, Stripe, maps).
        // /_next/* is excluded: headers on the dev HMR socket cause a reload loop.
        source: "/((?!_next/).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // No framing of the app (clickjacking), except the hosted lead form /f/*,
        // which business websites may embed in an iframe.
        source: "/((?!f/|_next/).*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
      {
        // Hand-written service worker (SPEC §12.3): always revalidated, locked-down CSP.
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'; connect-src 'self'",
          },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // Lead-capture snippet (B1 builds it): cacheable for an hour, loadable cross-site.
        source: "/embed.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
