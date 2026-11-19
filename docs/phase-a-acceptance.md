# Phase A Acceptance Evidence

**Scope:** test harnesses and owner boundary only. The scoped local checkpoint is implemented, exercised and independently approved. Final full cross-phase testing remains deferred until all phases, by user instruction. No Phase B work, push, deployment, production database access, real mail, or WhatsApp message occurred.

## Measured checks

| Gate | Actual result |
|---|---|
| Backend `npm test` | 31 tests passed before the final verifier-only cleanup repair, zero failures/skips. Actual loopback HTTP with explicitly mocked model methods; not rerun after the testing-order clarification. |
| Backend `TEST_MONGODB_URI=... npm run verify:phase-a` | 59 assertions passed against real disposable MongoDB, including anonymous/ordinary denial on 15 management endpoints, genuine bcrypt/JWT login, explicit profile DTO, owner property create/edit with database read-back, public contact/viewing persistence, and stored-user revocation/deletion denial. |
| Final focused `node --test test/verification-safety.test.js` | **15/15 passed after the cleanup repair**; five added failure-path tests execute the actual verifier CLI with a test-only mocked Mongoose preload (no DB/network/listener). |
| Nonempty-test-database guard | Refused the existing fixture DB, exited 1 as expected; before/after retained 2 users and 1 property. |
| Actual `node src/index.js` entrypoint | Connected to disposable MongoDB; root returned 200 with expected text; anonymous admin stats returned 401. Smoke server stopped afterward. |
| Frontend `npm test -- --run` | 47 tests across 5 files passed; mocked auth/Axios/DOM fixture coverage, not live auth evidence. |
| Frontend production build | Passed against the disposable API URL; existing bundle-size/Browserslist warnings remain. |
| Chromium production-preview acceptance | 17 checks passed against actual API/DB; 0 uncaught page errors, 12 observed API responses on the final post-fix run. Anonymous redirect; ordinary login/dashboard/admin denial; owner login, property listing, profile reload, token removal, mobile owner navigation. |
| Changed frontend TS/TSX/config ESLint | 0 errors, 1 pre-existing `useAuth` React Refresh warning. |
| Full frontend `npm run lint` | FAIL: 29 errors / 11 warnings, down from pre-change 30/11 because touched Login no longer uses caught `any`. No rules disabled. |
| Frontend `npm run typecheck` | FAIL: same 3 pre-change diagnostics in location-selector and saved-searches-manager. Node/config check passes. |
| `git diff --check` | Passed in both repositories at this revision. Staged whitespace is checked again before the checkpoint commit. |

Real API/browser fixtures were randomly generated, disposable, and did not use production credentials. Browser coverage used installed system Chromium through scratch-only Playwright tooling. A first browser attempt stopped on an ambiguous Login/Sign In selector; the harness was scoped to the login form and the complete flow rerun successfully. This was a harness correction, not a source workaround.

## Dependencies and known residuals

A current `npm audit --omit=dev --json` reports:
- Backend: 12 affected package entries (2 critical, 9 high, 1 moderate).
- Frontend: 35 affected package entries (2 critical, 24 high, 8 moderate, 1 low).

These are package-entry counts, not distinct exploits or confirmed runtime exposures. Backend dependency versions were unchanged. Every frontend production-advisory package/version was independently checked against the original lockfile and already existed there; added dependencies are test tooling. The install also refreshed shared `debug` and `@jridgewell/sourcemap-codec` within existing semver ranges; neither appeared among these production advisories. No broad dependency repair was attempted. Phase A is **not production security approval**; remediation needs its own scoped review before launch.

Existing user saved-search email/ID access and modifications remain public, as documented in the Phase A scope; this privacy/ownership gap is not fixed. The legacy email service remains broken/unconfigured until Phase E. `ADMIN_EMAILS` must be set to approved existing owner accounts before deployment; unset means all admin requests fail closed. Notification recipient remains TBD.

## Review and cleanup gate

- Backend specification review: initial review found a verifier credential-path containment gap. Reproduced with 2 new failing tests, fixed canonical path/component containment and symlink resolution; all 10 safety regressions pass. Targeted re-review PASS; no remaining specification gap.
- Frontend specification review: PASS on the immutable source snapshot.
- Frontend independent quality/security review: APPROVED, no blocking security or logic issues. Nonblocking suggestions: overlapping-login concurrency cases and rejected-login UI feedback coverage; reserved for later focused/final test work, not implementation blockers.
- Backend independent quality/security review: APPROVED after fixing the ownership/disconnect error path. Final r3 review verified the exact three-file source/test delta and all five mocked failure scenarios; no blocking concerns remain. This approval does not claim a post-repair real-database rerun.
- Local acceptance completed before the testing-order clarification. Servers stopped gracefully, browser fixture DB drop read back, exact owned tmpfs Mongo container removed, all owned ports released, 2 private scratch credential files deleted; no owned test containers/networks remain.
- Phase A checkpoint is the containing commit in each repository; exact staged paths and staged whitespace are checked before commit. Root plan/coordination files remain local because the workspace parent is not a Git repository.
- User clarification: retain phase checkpoints/approval; reserve final full cross-phase test pass for after all phases. Do not treat local Phase A evidence as final product acceptance.
- Next phase: B, **not authorized** until user approval after this checkpoint.
