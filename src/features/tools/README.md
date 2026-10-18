# tools (M18) — owner B7, flag `tools` (default off)

Tool register with photos, QR labels, kits, custody (check-out / check-in with condition +
photo and tech acknowledgment), audits ("tool checks"), incidents with ⚖️ gated deductions,
maintenance with due dates, the tech-owned registry and a printable theft report.

## Screens
- `/tools` — `?scope=mine|all`, `?status=`, `?holder=<userId>`. All: incidents to decide,
  tool checks (+ schedule), kits, check-out sheet (QR scan via `BarcodeDetector`, manual
  select fallback), list grouped by category. Mine: ack banner ("I have received these
  tools"), tool-agreement signing (B3 `SignatureSheet`), own tools and checks.
- `/tools/[id]` — details, due chips, custody history, maintenance log, incidents, tags,
  activity; actions by role (check out/in, repair, maintenance, report, retire, theft report).
- `/tools/[id]/theft-report` — print-ready page for police/insurance.
- `/tools/audits/[id]` — the tech's checklist (photo per tool or "Missing") / reviewer view.
- `/tools/labels` — QR label sheet (server-rendered SVG, prints 3 across).
- `/settings/tools` — audit frequency, handoff photo, calibration block, maintenance
  defaults by category, ⚖️ deductions (off) and agreement text.

## Rules (`rules.ts`, unit-tested in `tests/tools/rules.test.ts`)
- `checkoutBlock`: in_repair / lost / stolen / retired never; calibration overdue blocks
  (setting, default on); reassigning closes the previous custody first.
- `deductionAllowed`: deductions enabled AND not W-2 in a `compliance.wage_deduction_blocked_states`
  state AND a signed `tool_agreement`. A `tech_responsibility` decision then posts a
  **pending** `tool_deduction` (`needsReview`) via B6 `postLedgerEntry`.
- Maintenance log resets `next_maintenance_on`; calibration logs set the next due date;
  tech-paid maintenance → B6 `createPartPurchase` (category `tool`).

## Events, cron, slots
- Emits `tool.incident` (report, missing at audit), `tool.audit_due` (schedule),
  `tool.audit_submitted`, `tool.maintenance_due` (cron, N days before + on the day).
- Cron: `tools.audits` 05:20 (schedules per frequency, due tomorrow), `tools.maintenance` 05:30.
- Slots: S47 `TodayToolCard` (tool check, acks, due maintenance), S51 `ToolCustodyRow`.
  API: `getToolAuditStatuses`. `uses_company_tools = false` hides checks and reminders.
- `qr.ts` is a SHIM re-exporting B3's encoder until it moves to `src/lib/qr.ts`.
