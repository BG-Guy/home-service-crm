# Photos & evidence media (M11) — owner B4

Hashed, geostamped job photos with before/after tagging, a gallery with compare, and
photo embedding on invoices, receipts and the customer portal.

- **Capture (S24 `CameraCaptureButton`)** wraps the UI-kit `CameraButton`: compress
  (1600 px + 320 px thumb), SHA-256 of the original, geostamp, upload through the offline
  outbox (`/api/uploads/presign` → PUT → `/api/uploads/complete`, F-owned). Tag segments
  come from `getCaptureConfig()`; before/after disappear when the `before_after` flag is
  off; job photos disappear when `photos` is off (receipts, odometer, documents and tool
  photos always work). Originals are kept for `settings.media.keep_originals_tags`.
- **Flags**: `possibly_from_library` and `no_geo` at upload (F), `far_from_site` by the
  `photo.uploaded` handler (`settings.media.far_from_site_m`, GPS accuracy credited).
- **Gallery (S23 `JobPhotosPanel`)**: filter by tag, detail sheet (time, uploader, GPS,
  flags, lock state), star for the invoice, re-tag/caption, soft delete (`photos.delete`,
  reason, audited; blocked for evidence: issued invoice, signature, dispute), before/after
  compare slider (lazy `PhotoCompare`).
- **Embedding (`selectInvoicePhotos`)**: flags → company default
  (`invoices.photos_on_invoice/receipt`) → service type → invoice `show_photos` +
  ordered `photo_media_ids` → starred → latest 2 before + 2 after. Invoice ≤ 8 (2-up,
  Before/After captions, stamped CSS overlay with time · job # · address), receipt ≤ 4,
  portal = all starred. S26/S27 validate a public `tokenId` (no session).
- **Picker (S25 `PhotoPicker`)**: tap order = display order, hidden inputs `${name}[]`.

Files: `api.ts` (§6.4 contract), `actions.ts`, `queries.ts`, `geo.ts`, `labels.ts`,
`events.ts`, `slots.tsx`, `slots.client.tsx`, `components/JobPhotosGallery.tsx`,
`seed.ts` (demo fragment #11). Tests: `tests/media/media.test.ts`.

Extension: new tags go in `MediaTag` (contracts), `TAG_LABEL`, and `JOB_PHOTO_TAGS` when
they belong to the job gallery. Annotations, video and server EXIF are Later.
