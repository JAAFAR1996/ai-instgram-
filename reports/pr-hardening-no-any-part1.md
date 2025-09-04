# PR: hardening/no-any-casts (part 1)

Summary
- Begin systematic removal of `any` usages and unsafe casts.
- Replaced several `as unknown as` adapters in `ProductionQueueManager` with typed adapters.
- Removed double-casts for queue job payloads; used concrete interfaces instead.
- Tightened ESLint rules for TypeScript safety (`no-explicit-any`, `no-unsafe-*`, `no-empty`).

Scope
- `src/services/ProductionQueueManager.ts`: remove several `as any`/`as unknown as` and adapt Worker job shapes safely; replace error `.message` access with guarded checks; remove delayed/attempts casts.
- `eslint.config.cjs`: enforce strict rules for `any` and unsafe operations across TS files.
- `src/core/errors.ts`: add Result helpers `Result<T,E>`, `ok`, `err` for future refactors.

Measured impact
- Baseline anyCasts: 258 (see `reports/silencing-baseline.pretty.json`).
- After part 1: 251 (see `reports/silencing-after-pr3-step1.json`).
- Next parts will target top offenders (customer-profiler, instagram-* modules, db/adapter, sql-compat, repositories).

Risks
- Adapting job wrapper objects may surface type errors in Worker code paths—covered by runtime behavior mapping the same fields.

Next (part 2 targets)
- `src/services/customer-profiler.ts` (~10)
- `src/services/smart-orchestrator.ts` (~10)
- `src/services/instagram-manychat-bridge.ts` (~10)
- `src/services/instagram-media-manager.ts` (~9)
- `src/cache/index.ts` (~8)
- `src/services/instagram-ai.ts` (~8)
- `src/infrastructure/db/sql-compat.ts` (~6)
- `src/db/adapter.ts` (~6)

Target: Reduce anyCasts ≤ 120 by end of PR3.
