# pricebook — B3 (satellite of `estimates`)

Services, labor, parts, materials and fees, with the markup matrix.

- `/settings/pricebook` (`pricebook.manage`): items CRUD with categories, cost/price with markup and
  margin shown, the markup matrix (`settings.parts.markup_tiers`, B6's namespace edited here),
  CSV import/export (`csv.ts`, RFC 4180 quoting).
- S14 `PricebookPicker` (`slots.client.tsx`): searchable sheet used by the estimate, change-order
  and invoice editors and by B6's AddPart sheet. Controlled (`open`/`onOpenChange`) or with its own
  trigger.
- API (§6.3): `searchPricebook`, `getPricebookItem`, `priceFromMarkup`, `upsertPricebookItems`
  (B1's CSV import; match by SKU, else name).
- `avg_cost_cents` is maintained by B6 (stock moves). Tests: `tests/pricebook/pricebook.test.ts`.
