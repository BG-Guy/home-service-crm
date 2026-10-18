# settings (M21) — owner B8

The settings shell, the general pages, permissions, features and integrations, plus the
shared configuration APIs other modules read (service types, checklists, tags, custom
fields, tax rates, branding).

## Shell
- `/settings` index and `layout.tsx` are derived from every module's `nav.ts` entries
  with `section: 'settings'` (filtered by permission and feature flag). Phones get a
  grouped list; desktop shows a sticky settings column next to the page.
- Every page uses `components/SettingsScreen` (nav bar with Back, page gutters).
- To add a settings page in your module: add a `nav` item with `section: 'settings'`,
  `settingsGroup` and a `description`; it appears in the index automatically.

## Pages owned here
company, branding (accent color with live preview + contrast report, logos, app name,
invoice header), services (every service-type field), taxes, compliance ⚖️, tags,
custom-fields, checklists, features (all manifest flags), permissions (module × role
grid, locks), permissions/users/[id] (Inherit / Allow / Deny), integrations (active
drivers, write-only secrets — env wins, last 4 only — test buttons, VAPID public key),
profile (own profile, password, devices, sign out other devices, appearance, S35
notification preferences, S36 push, install).

## Rules
- Settings JSON is written only through F `updateSettings` (audited `settings.updated`).
- Permission locks come from `@/lib/permissions` (`checkRoleGridChange`,
  `checkOverrideChange`); every change is audited and emits `permission.changed`.
  Sessions re-read permissions on every request, so nothing needs invalidating.
- Secrets: `setSecret` (encrypted). A value in the environment always wins.

## APIs and slots for other modules
- `api.ts`: `listServiceTypes`, `getServiceType`, `getChecklistTemplate`, `listTags`,
  `getEntityTags`, `setEntityTags`, `getCustomFieldDefs`, `validateCustomValues`,
  `getTaxRates`, `getBrandingStyle` (root layout).
- `slots.client.tsx`: S55 `TagEditor` (checks the entity's edit permission, map in
  BUILD_PLAN §6.8) and S56 `CustomFieldsFields` (inputs named `custom.<key>` inside the
  consumer's form; validate with `validateCustomValues`).
- `seed.ts`: demo tags (+ applied to customers/jobs), custom-field defs, checklists,
  the after-hours lockout service type and the 8.25% tax rate.
