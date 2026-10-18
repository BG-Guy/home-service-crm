# insights (M20 dashboards) — owner B8

All KPIs are computed on view in SQL (`kpis.ts`, `ops.ts`) and rendered as Server
Components with the UI-kit's hand-rolled SVG charts. No caching tables, no cron.

## `/insights` (three variants, `?view=` when a viewer holds more than one)
- **Business** (`insights.view_financials`): collected and invoiced revenue, avg ticket,
  jobs completed, gross margin, company net per job, payroll cost %, AR outstanding +
  aging, estimate close rate, unsold estimates, lead → booked, median speed to lead and
  % within 5 min, lead-source ROI, callback / cancellation / no-show / review-click
  rates, dispute rate 30/90 d (alert at 0.75%), dispute win rate, cash held by techs,
  tech leaderboard, fleet (S52 `FleetSummaryCard`) and the weekly anomaly report.
  Δ vs the previous period on every comparable tile; CSV via `/insights/export`
  (`reports.export`).
- **Today / Ops** (`insights.view_ops`): the office board (also the S54 `OpsToday` slot
  on B2's `/today`) plus the team leaderboard with `insights.view_team`.
- **My stats** (techs, `insights.view_own`): today, S42 `MyEarningsCard`, own KPIs, cash
  on hand, pending reimbursements, S50/S51; rank only when
  `settings.insights.show_tech_rank`.

Periods: `?period=today|week|month|last30|custom&from=&to=` (`period.ts`, whole days in
the company time zone; "week"/"month" are to-date and compare with the same span before).
Every number links to the filtered list behind it (BUILD_PLAN Appendix A).

## Formulas (SPEC M20) — see `kpis.ts` comments
- Collected = succeeded deposits + payments (`succeeded_at` in period, tips excluded)
  − succeeded refunds created in period.
- Invoiced = Σ (subtotal − discount) of non-void invoices issued in period.
- Gross margin uses `job_financials`/`job_earnings` of jobs completed in the period:
  (revenue − company parts − fees − commission − spiffs − reimbursements) ÷ revenue
  (tech-paid parts are counted once, through reimbursements).
- Payroll cost % = Σ ledger commission + spiff + guarantee/OT top-ups ÷ collected.
- Speed to lead counts business minutes only when `leads.sla_business_hours`.

## Extending
Add a KPI: write the SQL in `kpis.ts` (return cents / fractions / nulls, never NaN),
add a test in `tests/insights/kpis.test.ts`, then a `StatCard` in the dashboard with a
drill-down `href`. Anomaly signals are rows in `getAnomalies()`.
