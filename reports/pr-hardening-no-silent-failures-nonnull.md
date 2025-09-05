# PR: hardening/no-silent-failures-nonnull

Summary
- Enforce zero non-null assertions in production code.
- Verify baseline shows none; add guard rails in future CI gate.

Why
- Non-null assertions (`!`) mask potential undefined/null errors at runtime.

Measured impact (totals)
- nonNullAssert: 0 → 0 (no occurrences found).

Notes
- Keep CI gate to ensure it stays at zero (covered in PR6).

Artifacts
- Baseline: `reports/silencing-baseline.json`
- Latest audit: `reports/silencing-after-pr3.json`

