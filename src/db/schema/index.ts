// All Drizzle tables (docs/SPEC.md §6). One file per spec subsection / owning module.
// Core query builder only — no relations().
export * from "./company"; // §6.2 company, auth, team, config
export * from "./customers"; // §6.3 customers, properties, consent, leads
export * from "./documents"; // §6.5 estimates, invoices, signatures (+ invoice_balances view)
export * from "./jobs"; // §6.4 jobs, scheduling, notes
export * from "./media"; // §6.7 media
export * from "./messaging"; // §6.8 messaging, automations, notifications, portal
export * from "./parts"; // §6.9 parts & inventory
export * from "./payments"; // §6.6 payments, deposits, disputes, risk
export * from "./payroll"; // §6.10 commission, payroll, payouts
export * from "./system"; // §6.13 location, activity, audit, system (+ approvals, ai_tasks, ai_usage)
export * from "./tools"; // §6.12 tools
export * from "./vehicles"; // §6.11 vehicles
