<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project rules

Read [`CLAUDE.md`](CLAUDE.md) first: commands (npm only), architecture, hard rules, the
lead-engineer amendments (no `cacheComponents` / `'use cache'` in v1) and how to add a module.
Product behavior is in [`docs/SPEC.md`](docs/SPEC.md); ownership and cross-module contracts are
in [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md).
