# PR: hardening/boundary-validators (PR4)

Summary
- Enforced Zod validation at ingress and minimized payloads for webhooks/queue.
- Introduced a central minimal ManyChat event schema and removed non-null assertions and `any` at the boundary.

Changes
- Added `src/types/manychat.ts`:
  - `MCImage`: `{ url: string }` only.
  - `MCEvent`: `{ merchantId, customerId, username, text, images }` with Zod.
- Updated `src/routes/webhooks.ts`:
  - Normalize attachments into `images: { url }[]` only.
  - Removed `i.url!` non-null assertion and any-casts.
  - Built `MCEvent` from sanitized inputs and validated with Zod before enqueueing.
  - Replaced `msgs as any` with typed `ConversationMsg[]`.
- Queue contract already accepts `{ url }[]` (no buffers/base64) via `ManyChatJob`.

Impact (audit)
- `typeAny`: 95 → 93.
- `asAny`: 96 → 95.
- `nonNullAssert`: remains 0.
- Report saved: `reports/silencing-after-pr4.json`.

Notes
- Many HTTP routes already use Zod (admin, merchant-admin, utility-messages). Image-search remains multipart; header validation can be added later.

Next
- Use this report as CI baseline for the silencing gate:
  - `SILENCING_BASELINE=reports/silencing-after-pr4.json npm run ci:silencing`

