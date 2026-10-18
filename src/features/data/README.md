# data (M24) — owner B1

Export everything, CSV import, nightly backups and restore.

- **Export** (`data.export`): Settings → Data → "Export everything" queues a `job_queue`
  `export` job. `engine.ts#buildFullExport` writes a store-only zip (`zip.ts`, no
  dependency) with `tables/<table>.json` (sessions, secrets, rate limits and queues
  skipped; password, key and token hashes, bank numbers and gate codes redacted),
  `csv/{customers,properties,jobs,invoices,payments,leads}.csv` (formula-injection safe)
  and `media/manifest.json` plus files (up to 400 MB). Stored at `exports/<id>.zip`;
  `GET /api/export/<id>` redirects to a signed URL until the 24 h expiry.
  CLI: `npm run export -- out.zip [--no-media]`.
- **Import** (`data.import`): wizard (type → CSV → column mapping with auto-guess →
  dry-run preview with duplicates and skipped rows → import). Customers (+ properties;
  a consent column records `recordConsent(source 'import')`), price book (B3
  `upsertPricebookItems`), past jobs (B2 `importHistoricalJobs`; customers matched or
  created). Phone/email matches update instead of duplicating.
  CLI: `npm run import:csv -- customers file.csv [--dry-run]`.
- **Backups**: cron `data.backup` (02:00 company time) queues a `backup` job: JSON per
  table under `backups/YYYY-MM-DD/` + `manifest.json`; keeps 14 daily and 8 weekly
  copies (`settings.data`). `data.exports_prune` (03:30) expires download links.
- **Restore**: `npm run restore -- backups/2026-10-14 --yes` replaces all data (empties
  the tables, reloads them in foreign-key order with `json_populate_recordset`, resets
  sequences). It also accepts a downloaded local folder.
- **Danger zone**: "Reset demo data" (development or `DEMO_MODE=1`, admins only, type
  RESET) runs the demo seeder in reset mode.
