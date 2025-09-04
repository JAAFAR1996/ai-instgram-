# PR: hardening/no-any-casts (PR6 - round 1)

Summary
- Reduced `typeAny` and `as any` across hot spots with narrow types and existing schemas.
- Replaced several `as any` casts with concrete types; eliminated `any` in SQL generics.

Changes
- `src/services/instagram-media-manager.ts`:
  - Typed analysis helpers with `ImageAnalysisResult` and `ImageLabel`.
  - Removed `(m: any)` in productMatches mapping.
- `src/services/instagram-ai.ts`:
  - Narrowed search mapping to explicit product shape (no `any`).
  - `settings: any` → `Record<string, unknown> | null` in SQL result.
  - Multimodal content cast switched to OpenAI typed union (no `any`).
- `src/services/smart-orchestrator.ts`:
  - `ai_config/settings: any` → `Record<string, unknown> | null` in SQL/result.
  - Removed `as any` on ConstitutionalAI contexts; use typed `ResponseContext` shape.
  - Replaced `const p: any` with a minimal product type where needed.
- `src/services/monitoring.ts`:
  - `setRedisConnection(redisConnection: any)` → `Redis` type.

Impact (audit)
- Before (post PR4): `typeAny: 93`, `asAny: 95`.
- After round 1: `typeAny: 77` (−17.2%), `asAny: 92` (−3.2%).
- Non-null assertions remain 0.

Next steps (round 2 target ≤40)
- Focus files: `ProductionQueueManager.ts` (casts on session/settings), `response-enhancer.service.ts`, `service-controller.ts`.
- Replace remaining SQL generics carrying `any` with precise row types.
- Remove `as any` in tests where practical, or scope audit to `src/` in CI gate if tests are excluded by policy.

