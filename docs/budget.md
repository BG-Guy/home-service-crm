# Performance budget

Budgets from SPEC §14. Measured on the production build after QA round 2 (`npm run build`,
2026-10-17, all modules live), gzip of the chunks a route's entry lists in its client
reference manifest. "Route JS" = page chunks minus the root/`(app)` layout chunks and the
framework (it still counts chunks shared by several routes, so it is an upper bound).
Previous measurement (2026-10-15 integration) in brackets.

| Budget | Limit | Measured | Status |
|---|---|---|---|
| Shell JS (framework + root and `(app)` layouts) | ≤ 150 KB gz | 149.9 KB gz [149.4] | ok (0.1 KB headroom) |
| Route-specific client JS | ≤ 30 KB gz per route (map excluded) | most routes 3–28 KB; 12 app/public routes over (below) | **over** on 12 routes |
| CSS | ≤ 25 KB gz | 17.2 KB + 2.6 KB gz [16.9 + 2.6] | ok |
| `public/embed.js` | ≤ 3 KB gz | 3,783 B raw, 1.8 KB gz | ok |
| `public/sw.js` | ~3 KB | 1.4 KB gz | ok |
| `/map` (excluded from the route budget) | — | 22.7 KB + Leaflet ~43 KB in a lazy `ssr:false` chunk | ok |

Re-measured after the final QA2 polish (same day): 149.9 KB. The +0.5 KB most likely
comes from the verification-pass edits to shell files (upload, phone format, alert, app
shell), which changed after the first measurement; the final polish changed no module in
the layout chunks. The shell grew 1.6 KB in QA round 2. The new shell pieces are the `useConfirm` external
store, nav-derived loading titles and the ⌘K launcher (the palette itself loads on first
use); the per-chunk split wasn't measured. There is almost no room
left: the next shell addition must pay for itself (see "Ship the remaining app shell" below).

### First-load JS (gz) after QA round 2

| Route | First load | Layouts + framework | Route JS |
|---|---|---|---|
| Shell (`(app)` layouts) | 149.9 KB | 149.9 KB | — |
| `/today` | 194.3 KB | 149.9 KB | 44.4 KB |
| `/jobs/[id]` | 229.3 KB | 149.9 KB | 79.4 KB |
| `/customers/[id]` | 218.5 KB | 149.9 KB | 68.6 KB |
| `/insights` | 176.0 KB | 149.9 KB | 26.2 KB |
| `/login` (`(auth)` layouts) | 142.0 KB | 135.1 KB | 6.9 KB |

### Routes over 30 KB gz (QA/perf follow-up)

| Route | Route JS (gz) | Likely cause / fix |
|---|---|---|
| `/jobs/[id]` | 80.6 KB [75.9] | All slot islands (action bar, collect, parts lines, consent, review button, notes, photo compare, signature sheet) load eagerly; QA2 added the compact dock and photos sheet. Lazy-load the tech sheets and the photo/signature pieces behind first open. |
| `/customers/[id]` | 68.4 KB [68.0] | Same slot islands (S4/S5/S29–S37) on the customer page; lazy-load composer and timeline actions. |
| `/settings/reminders` | 47.0 KB [47.5] | Reminders manager + template editor on one route; split the editor. |
| `/estimates/[id]` | 44.7 KB [43.4] | Estimate builder + pricebook picker + doc sheets. |
| `/today` | 44.2 KB [44.0] | My Day + Ops board + clock card + vehicle/tool cards; lazy-load the office board for techs and vice versa. |
| `/leads/[id]` | 44.1 KB [46.0] | Lead actions, edit sheet, composer. |
| `/invoices/[id]` | 41.9 KB [40.8] | Line editor + pricebook picker + invoice controls. |
| `/team/[id]` | 37.3 KB [37.2] | Member controls + edit sheet + overrides. |
| `/i/[token]` (public) | 35.2 KB [30.1] | Receipt flag form + pay CTA + receipt labels; lazy-load the flag sheet. |
| `/j/[token]` (public) | 33.8 KB [28.7] | Job portal actions (confirm/reschedule, documents); lazy-load the reschedule sheet. |
| `/vehicles/[id]` | 33.4 KB [31.7] | Six tabs of log sheets. |
| `/today/finish` | 32.2 KB [33.2] | Finish-my-day sheet pieces. |

`/insights` dropped under the budget (26.1 KB, was 35.4 KB). `/dev/ui` (38.0 KB) is the
dev-only gallery and isn't budgeted.

## `/today` shell breakdown at F5 (gz, historical)

| Chunk | Size | What |
|---|---|---|
| react-dom (React 19.3.1) | 71.8 KB | framework |
| Next.js app router client | 45.0 KB | framework |
| Turbopack runtime + small framework chunks | ~10 KB | framework |
| Sheet / ActionSheet / dialogs, TabBar, Toast, outbox + upload, install prompt, lazy wrappers | ~34 KB across several chunks | app shell |

F5 removed the global `MotionProvider` (~30 KB: LazyMotion + async `domAnimation`; no
component used `m.*`) and moved the "+" menu icon rendering to the server (the client had
imported the whole `@/ui/icons` map).

The framework alone (React + Next router + runtime) is ~127 KB gz, leaving ~23 KB for the
app shell under the 150 KB budget.

## Exceptions

| Item | Size (gz) | Reason | Alternatives considered |
|---|---|---|---|
| `leaflet` (B7) | ~43 KB | Live map only; loaded in a lazy `ssr:false` chunk on `/map`. | MapLibre (banned, heavier); static map images (no live markers). |
| Payroll engine on `/settings/commission` (B6) | ~8–10 KB | Live commission calculator runs the pure engine client-side on that route only. | Server round-trip per keystroke. |
| QR encoder `src/lib/qr.ts` | ~2 KB | Server-rendered SVG on invoices and tool labels; client only inside the lazy collect sheet. | — |
| Framework baseline (Next 16.4 + React 19.3) | ~127 KB | The SPEC's 150 KB assumed a smaller framework baseline. Not under app control. | Preact compat (not supported by Next App Router) |
| `motion` LazyMotion + async `domAnimation` | ~30 KB, only where used | Not in the shell any more (F5). A component that needs `m.*` wraps its own subtree in `<MotionProvider>`, ideally inside a lazily loaded chunk. | `src/ui/motion/spring-driver.ts` (0.5 KB) for gesture releases. |
| Ship the remaining app shell (~50 KB) | — | Sheet, toasts, tab bar, outbox, install prompt. | Audit after modules land: lazy-load ActionSheet/Sheet behind first open, move InstallPrompt out of the initial route. |

Rule (§14.3): any new client dependency over 5 KB gz needs a row here (name, size, reason,
alternative considered).

## How to measure

```bash
npm run build && COOKIE_INSECURE=1 SESSION_SECRET=dev-check-secret-1234 npm start
# sign in, open the route, then sum gzip -9 sizes of the /_next/static chunks it loaded
npm run analyze   # Turbopack bundle analyzer
```
