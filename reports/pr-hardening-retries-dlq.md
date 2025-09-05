# PR: hardening/retries-dlq (PR5)

Summary
- Added unified retry wrapper with exponential backoff + jitter and DLQ on exhaustion.
- Wired retries for queue enqueue ops and critical DB writes in webhooks.
- Exposed basic metrics: `retries_total`, `errors_total`, `dlq_enqueued_total`.

Changes
- `src/utils/retry.ts`:
  - `withRetry(fn, key, { attempts=3, logger, payload })` with backoff and telemetry.
- `src/queue/dead-letter.ts`:
  - Added `enqueueDLQ(reason, payload)` utility and metrics on enqueue.
- `src/services/ProductionQueueManager.ts`:
  - Wrapped `queue.add` for `process-webhook`, `ai-response`, `manychat-processing` with `withRetry`.
- `src/routes/webhooks.ts`:
  - Wrapped DB calls (select/insert conversation, select history, insert message) with `withRetry`.

Metrics
- `retries_total{key,attempt}`: increments for each retry attempt.
- `errors_total{key}`: increments when retries are exhausted.
- `dlq_enqueued_total{reason}`: increments when an item goes to DLQ.

Notes
- Redis operations already centralized via `safeRedisOperation`; queue.enqueue now benefits from retries.
- Further adoption recommended in HTTP clients (ManyChat/OpenAI) and other DB hotspots.

