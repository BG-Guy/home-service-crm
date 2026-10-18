# signatures — B3 (satellite of `invoices`)

Evidence-grade e-signatures for every group (ESIGN Act).

- `captureSignature(tx, input, actor)`: `doc_sha256 = sha256(canonicalJson(docSnapshot))`,
  policy version ids, signer (typed name + drawn PNG), channel (`in_person`, `remote_link`,
  `verbal`), consent text, IP, user agent, geolocation (when allowed), device time, token id.
  Append-only (DB trigger); locks the signature image as evidence (B4); emits `signature.captured`.
  Consent is required except for verbal approvals.
- `hasSignature`, `getLatestSignature` for readiness, evidence packs and payroll.
- S15 `SignatureSheet` (`slots.client.tsx`): consent checkbox, typed name, the lazy
  `SignaturePad`; uploads the PNG through the session outbox, or `/api/uploads/public/presign`
  + `/complete` when `publicToken` is set (remote signing); then calls the CONSUMER's action with
  `SignatureSubmit`. Optional extras: controlled `open`, `onSigned`, `geo`.
