# PR: hardening/no-silent-failures-catches

Summary
- Remove silent catches: empty `catch { /* ... */ }` and noop `.catch(() => {})` across the codebase.
- Establish measurable baseline and after report via `scripts/audit-silencing.mjs`.

Why
- Silent catches hide failures and undermine observability, alerting, and SLOs.
- This PR enforces: every error is logged and either rethrown or handled as a controlled result.

Scope of changes
- Code changes:
  - `src/isolation/context.ts`: log failed transaction rollbacks instead of comment-only catch.
  - `src/middleware/idempotency.ts`: log body-parse failures while generating idempotency key (continue safely).
  - `src/startup/validation.ts`: log and continue for OS/Redis checks instead of comment-only catches.
  - `scripts/*.js|cjs`: replace `.catch(()=>{})` with logging in rollback/cleanup paths.
- Tooling:
  - Baseline audit saved to `reports/silencing-baseline.json`.
  - After-report saved to `reports/silencing-after-pr1.json`.

Measured impact (totals)
- catchIgnoreComment: 5 → 0 (−100%).
- catchNoopArrow: 4 → 0 (−100%).
- No change yet to: `typeAny`, `asAny`, `asUnknownAs`, `falsyOr*`, `thenSecondArg`, `allSettled` — covered by next PRs.

Risks
- More explicit error handling may surface previously hidden failures. This is intentional for production hardening.
- Rollback/cleanup failures are logged but do not shadow primary errors.

Artifacts
- Before: `reports/silencing-baseline.json`
- After: `reports/silencing-after-pr1.json`

Next PRs
1) hardening/no-nonnull-asserts — Verify and enforce zero non-null assertions; add guards where needed (baseline indicates 0).
2) hardening/no-any-casts — Systematically reduce `any`, `as any`, and `as unknown as` with narrow types + Zod validators.
3) hardening/boundary-validators — Zod on HTTP, webhooks, queue payloads, and DB IO mapping; eliminate overbroad payloads.
4) hardening/retries-dlq — Exponential backoff + jitter for external calls; DLQ wiring and metrics.
5) hardening/ci-gates — CI job to fail on silencing regressions and ensure coverage threshold.

