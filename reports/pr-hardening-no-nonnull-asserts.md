# PR: hardening/no-nonnull-asserts

Summary
- Remove all non-null assertions `!` from production code paths and replace with safe guards.

Changes
- `src/config/index.ts`: replace `env.X!` with `getEnvVar('X')` for required variables; parse `CORS_ORIGINS` safely using `??`.
- `src/repos/template.repo.ts`: remove `row!` usages; data already guarded.
- `src/repos/product-search.ts` and `src/repos/product-finder.ts`: avoid `entities.free!` by using `?.length ?? 0`.
- `src/services/ProductionQueueManager.ts`: guard `this.queue` before `.add/.close/.getActive`, removing `!`.

Impact
- Silencing audit `nonNull` total: 17 → 0 (−100%). See `reports/silencing-after-pr2.json`.

Risks
- Early throws for missing envs if previously relied on implicit non-null; aligns with hard-fail policy.
- Queue methods now no-op with warning when queue is absent in test mode; avoids crashes with clear logs.

Next
- Address remaining `any` casts, boundary Zod validators, retries/DLQ, and CI gates in subsequent PRs.

