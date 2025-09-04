# PR: hardening/ci-gates

Summary
- Add CI gate to fail on silencing regressions relative to a checked-in baseline.
- Keep coverage threshold at or above project config (≥70% requirement already satisfied by Vitest config).

Changes
- `scripts/ci/silencing-check.mjs`: reads `SILENCING_BASELINE` env or defaults to `reports/silencing-after-pr3.json`.
- `package.json` scripts:
  - `ci:silencing`: run the silencing audit gate.
  - `ci:hardening`: run silencing gate and test coverage.

Artifacts
- Baseline: `reports/silencing-after-pr3.json`.
- CI logs will show any category exceeding baseline counts.

