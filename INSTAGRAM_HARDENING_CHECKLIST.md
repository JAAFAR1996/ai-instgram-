# Instagram Production Hardening — AI Sales Platform

Status: **Not production-ready**. Apply all items in this checklist. Order matters.

---

## 0) Unify Ports and Process Model
Unify port configuration across `.env`, Dockerfile, and compose. Recommend `10000`.

---

## 1) Environment Variables — Mandatory Validation
Validate at startup: `META_APP_ID`, `IG_APP_SECRET`, `GRAPH_API_VERSION`, `API_BASE_URL`, `ENCRYPTION_KEY`, `DATABASE_URL`, `REDIS_URL`, `OPENAI_API_KEY`, `PORT`.

---

## 2) OAuth PKCE — Correct and Enforced
Store `code_verifier` in Redis keyed by merchant+state with TTL 10m. Require it on callback.

---

## 3) Webhook Idempotency — Per Merchant
Event id = `sha256(merchant_id + rawBody)` or DB UNIQUE `(merchant_id,event_id)`.

---

## 4) Redis — Mandatory, Secure, and Observable
No in‑memory fallback. Fail fast if Redis absent. Require TLS/password in prod.

---

## 5) Distributed Rate Limiting (Meta/Instagram)
Redis sliding window by merchant+endpoint. Throttle before Meta bans.

---

## 6) Graph API Retry/Backoff Wrapper
Wrap calls with retries on 429/5xx. Use exponential backoff + jitter.

---

## 7) Dead Letter Queue (DLQ) + Alerts
On repeated job failure push JSON to `dlq:*` and alert Prometheus/Sentry.

---

## 8) Encryption Key Rotation
Prefix ciphertext with `kver`. Dual read old/new. Rotate periodically.

---

## 9) Token Renewal (Instagram Long-Lived Tokens)
Refresh proactively before expiry. Alert on failure.

---

## 10) Input and Media Validation
Cap AI text ≤2KB. Validate media type/size before upload.

---

## 11) RLS Enforcement in Application
Call `set_merchant_context()` each request. Use RLS-enforced DB role. Test cross-merchant isolation.

---

## 12) ensurePageMapping.ts — Secure
Ensure table has `(merchant_id,instagram_page_id)` PK. Store tokens encrypted. Apply RLS.

---

## 13) Webhook Signature Verification
Verify `X-Hub-Signature-256` with raw body and IG secret.

---

## 14) Docker — Multi-Stage, Consistent
Use multi-stage Dockerfile, omit dev deps in runtime. Align ports. Run as non-root.

---

## 15) Nginx and TLS
Terminate TLS at Nginx with valid certs. Enforce HSTS, CSP. Proxy to correct port.

---

## 16) Acceptance Tests — Gate to Ship
Test PKCE flow, webhook replay, 429 handling, Redis down, RLS negative.

---

## 17) Operational Runbook
Document: key rotation, token renewal, DLQ drain, rate-limit throttle, Redis/DB failover.

---

## 18) Clean .env.example
Use only placeholders. Add `META_APP_ID`. Align API version. Limit CORS origins.
