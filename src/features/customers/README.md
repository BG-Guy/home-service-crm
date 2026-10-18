# customers (M03) — owner B1

Customers, service addresses (properties), global search, the call log, duplicate
detection, merge and anonymize. The single source of truth for "who is the customer and
where do we go".

## Screens
| Route | What |
|---|---|
| `/customers` | Search (name, any phone format, email, street, job/invoice #), chips `type= tag= flag=`, keyset infinite scroll. Desktop: list–detail split. |
| `/customers/new` | Create with a duplicate prompt (exact phone/email, fuzzy street + ZIP), first property, verbal SMS consent, "How did you hear about us?". |
| `/customers/[id]` | §5.3 composition: header card + quick actions, contact (calls go through the app and are logged), properties CRUD (gate code encrypted at rest), jobs/estimates/invoices/payments panels, notes, tags, custom fields, timeline, consent, flags. Menu: edit, archive (soft delete), anonymize. |
| `/customers/[id]/merge` | Choose the surviving value per field, re-point every FK (§11.2 list), `merged_into_id` tombstone, audited. |
| `/customers/export` | CSV of the customer list (`customers.export`). |

## Contracts (BUILD_PLAN §6.1, §5)
- `api.ts`: `findOrCreateCustomer` (match E.164 phone/phone_alt, then email; fills blanks, never overwrites; property by normalized street + ZIP; time zone from ZIP; queues `geocode`), `findCustomerMatch`, `ensureProperty`, `assertCustomerAccess`, `getCustomerBrief` / `getPropertyBrief` (viewer-aware masking via B2 `getContactWindowJob`; gate code only inside the job window), `setCustomerFlags`, `addCardFingerprint`, `setCustomerSmsStatus` (B5 only), `logCall`.
- `search.ts`: `globalSearch(q, viewer, limit)` — one UNION of index-friendly prefix lookups, row-scoped for techs.
- Slots: `CustomerCard`, `PropertyCard` (`slots.tsx`), `CustomerPicker` with inline quick-create (`slots.client.tsx`).

## Rules worth knowing
- Row scope lives in the DAL: techs see customers of their assigned jobs (or ones they created); contact details are masked outside the active job window, and every reveal or dial by a tech is audited (`customer.viewed`, `customer.contact_dialed`).
- `sms_status` is derived from B5's consent ledger: never write it directly.
- Merge and anonymize are the only cross-owner writes (BUILD_PLAN §11.2).

## Runtime hooks
- `workers.ts`: `geocode` (Census by default, `GEOCODER` env; 1 request/s; never overwrites a manual pin).
- `seed.ts`: 40 demo customers / 48 properties with access notes and encrypted gate codes, 5 pinned notes.

## Extending
- New customer field: prefer a custom field (Settings → Custom fields, entity `customer` / `property`); it renders through B8's `CustomFieldsFields`.
- New flag: add the column (schema change), then `CustomerFlags`, `FLAG_LABEL` in `api.ts` and `FlagsEditor`.
