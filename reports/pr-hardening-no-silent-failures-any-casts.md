# PR: hardening/no-silent-failures-any-casts

Summary
- Reduce unsafe TypeScript constructs: `: any` in catch params and obvious casts.
- First pass codemod: `catch (e: any)` → `catch (e: unknown)` across `src/`.

Why
- `any` disables type safety and bypasses the compiler.
- Catch parameters should use `unknown` and be narrowed.

Scope of changes
- Codemod: `scripts/codemods/catch-any-to-unknown.mjs`.
- Affected files: 7 TypeScript files (see git diff).

Measured impact (totals)
- typeAny: 112 → 95 (−15.2%).
- asAny: 96 → 96 (0%).
- asUnknownAs: 12 → 12 (0%).

Risks
- Some catch blocks may now require explicit narrowing; address in follow-up patches.

Artifacts
- Before: `reports/silencing-baseline.json`
- After (this PR): `reports/silencing-after-pr3.json`

Next steps
- Replace remaining `as any` with branded or narrow types + Zod validators where appropriate.
- Map `as unknown as` bridges to typed interfaces or safe adapters.

