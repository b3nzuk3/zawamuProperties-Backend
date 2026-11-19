# Phase B acceptance — backend contracts and feature API

## Scope
User authorized Phase B and explicitly removed migration. No migration script, backfill, catalog-seeding job, production change, deployment, or real notification is included. Phase C owner forms and subsequent public rendering/viewing/enquiry/saved-search changes are not started.

## Implementation
- Property write allowlist, merged-record validation, optional structured location fields and legacy read-time defaults/fallbacks.
- Sale/rent types and compatible availability; positive finite price, percentage discounts, decimal half-up effective KES price.
- Optimistic concurrency and HTTP 409 for stale saves prevent separately validated partial edits from silently creating incompatible state.
- Public feature list and persisted-owner-only creation; normalized unique nameKey, duplicate-key race recovery, immutable property string snapshots. No feature rename/delete.
- Explicit null purpose/status/offer rejected by model and API; defaults apply to absent values, not invalid historical values. Invalid historical fields remain visible rather than silently repaired.

## Verification
- Before edits: `npm test`: 36 passed, no skips/failures.
- Initial finalization reproduced two new failures (half-cent rounding and missing optimistic concurrency); fixed both. Independent spec review found schema accepting null purpose; reproduced RED, required purpose/status/offer and added null regressions.
- After final source/test repair: `npm test`: 65 passed, 0 failures/skips. Suite combines domain/model validation and real loopback HTTP with explicitly mocked storage. These are not database integration tests.
- Separate parent-run scratch acceptance `verify-zawamu-phase-b.mjs`: PASS, 21 checks before cleanup, against a new dedicated MongoDB 8.0 tmpfs container and the real Express app. Eight parallel case/whitespace feature POSTs yielded one creation and one stored catalog row; anonymous/ordinary feature POST denied; rental create/update had DB read-back; invalid state rejected; legacy raw record remained byte-structurally unchanged after GET; explicit legacy edit retained image/feature snapshots; competing hydrated saves rejected stale document with VersionError. Empty-target ownership check preceded writes; database dropped and empty collections read back; HTTP closed/disconnected in finally. This is ad-hoc integration evidence, not a committed acceptance runner or production evidence.
- No frontend source changed. Its historical Phase A typing/lint/dependency issues remain; frontend build/browser/final cross-phase acceptance are not repeated for this backend-only checkpoint.
- Backend has no build/typecheck/ESLint scripts; Node syntax checks cover changed JavaScript. Do not describe syntax as type/lint checking.

## Final quality follow-up
Independent quality review `deleg_f1e31537` APPROVED, with a conditional concurrency concern for imported records lacking `__v`. Parent verified Mongoose omits that predicate, added an explicit missing-version save fence, and extended the HTTP regression assertion. Final ad-hoc Mongo/HTTP acceptance PASS: **24 checks before cleanup**, including two actual HTTP edits forced to read the same versionless snapshot using a test-only barrier around real Mongo reads; statuses were 200/409, persisted version 1 and compatible purpose/status. This supersedes the earlier 21-check run. An initial expanded-harness attempt hit a duplicate fixture ID because Mongo insertOne mutates the input; assigning the additional fixture a fresh ObjectId corrected the harness, not application code.

The existing frontend edit form spreads read-only response fields into PUT and will be rejected by the new allowlist. **Do not deploy backend-only as an independently compatible editor release.** Phase C must submit only editable fields before any combined deployment. This is deliberately deferred UI scope, not claimed working today.

## Reviews and stopping rule
Specification re-review PASS (`deleg_5405a0b6`); quality APPROVED (`deleg_f1e31537`); targeted versionless-save re-review APPROVED (`deleg_de2b2645`, generated filter/update checked and65 tests rerun). The commit containing this document is the approved Phase B checkpoint on backend master. STOP before Phase C. No push or deployment authorized.

## Known deferred risks
Existing saved-search ownership/privacy gaps, SMTP defects/configuration, recipient TBD, inherited dependency advisories, and frontend baseline debt remain outside this checkpoint. Existing catalog strings are not automatically imported. Unknown legacy types remain readable but must be corrected to a supported type on explicit edit. Feature uniqueness depends on the declared Mongo unique index being present; disposable acceptance initialized and exercised it. This is not production launch approval.
