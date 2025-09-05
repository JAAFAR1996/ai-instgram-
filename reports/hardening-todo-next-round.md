# Hardening TODOs and Next Round Plan

Snapshot (after PR3)
- typeAny: 95
- asAny: 96
- asUnknownAs: 12
- falsyOrOther (|| 0/false/NaN): 175
- thenSecondArg (.then(onFulfilled, onRejected)): 4
- allSettled (needs explicit failure handling): 3
- nonNullAssert: 0
- catchIgnoreComment/catchNoopArrow: 0
- falsyOrStringNullUndef: 0

Next Round Plan
- PR4: boundary-validators
  - Add/extend Zod schemas on HTTP routes, webhooks, queue payloads, and DB IO mappers.
  - Ensure only minimal fields go into queues; remove buffers/base64.
  - Introduce request-scoped context: request_id, merchant_id, conversation_id in logs.
- PR5: retries-dlq
  - Wrap external calls (DB/HTTP/Redis/FS) with retries (exponential backoff + jitter), max attempts, and final push to DLQ.
  - Add metrics: error_rate, dlq_depth, unhandled_rejection, p95_latency.
- PR6: ci-gates
  - Wire `scripts/ci/silencing-check.mjs` into CI to fail on silencing regressions using `reports/silencing-after-pr3.json`.
  - Keep coverage threshold via Vitest (currently ≥80/90% in config; acceptable over the requested 70%).

De-risking Notes
- Address `any`/casts incrementally with narrow types and validators to avoid breaking changes.
- Replace `falsyOrOther` usage (|| false/0/NaN) case-by-case; decide desired semantics vs nullish coalescing.

