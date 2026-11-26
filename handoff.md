# Backend Handoff — Launch Readiness

## HEIC/HEIF upload follow-up — COMPLETE / STOP

Single-image HEVC HEIC/HEIF now decodes through pinned `libheif-js@1.23.5` in a fresh terminable 15-second worker and feeds the unchanged metadata-free WebP variants/R2 URL contract. Existing 8 MiB/24 MP/ten-file/one-batch limits and owner authorization remain. HEIF item transforms control orientation; descriptive EXIF is deliberately ignored, independently tested and documented against the standard. Native Sharp header inspection remains outside the worker deadline; V8 heap limits do not cap WASM/native memory. See `docs/heic-uploads.md` for deployment/license/resource details.

Clean installs, backend 194 tests, frontend 244 tests/32 files, frontend typecheck/full and changed lint/build, backend changed syntax/whitespace and all four dependency audits passed. Existing build chunk warning remains. Production Chromium passed 8 scenario checks/63 responses, four real client-HEIC multipart conversions across edit at 390/1440px, create and blog; zero console/page errors. Fixture save/reload retained canonical WebP URLs and decoded thumbnails. Catalogue/profile/owner model/property/blog saves and S3 method calls are in-memory doubles, not Mongo/R2 acceptance; versioned loopback separately exercises real signed AWS SDK HEIC read-back/compensation. Client photo is not versioned/archived. Owned browser/server/objects closed and verified, generated private key removed. Source bindings and verifier archive: `docs/heic-uploads-evidence.json`. Independent backend re-review `deleg_ddc2a866-2` approved (8/8 focused tests); frontend review `deleg_ddc2a866-1` passed (21/21 focused tests across 3 files). No required changes remain within the documented scope. Blog creation is covered; the pre-existing blog edit dialog has no file picker and is not expanded here. The scoped commit containing this handoff completes the local checkpoint; STOP afterward. No push, deployment, production/provider/database operation, messages, migration or backfill. The following R2/phase entries are historical.

## R2 / application WebP checkpoint — COMPLETE / STOP

Cloudinary SDK/configuration/upload code is removed. Owner-only `POST /api/upload` now validates/auto-rotates/strips metadata and creates bounded thumbnail320/card768/large1600 WebPs with Sharp, then stores immutable UUID objects in R2 through explicit backend-only credentials. `{ urls }` and existing property/blog string fields are unchanged. Byte/pixel/file/process-admission bounds, safe JSON errors, attempted-key compensation and mandatory R2 readiness configuration are covered. No schema migration/backfill, provider fallback or automatic orphan GC is added. Existing hosted legacy URLs remain readable and must be separately transferred/replaced before account cancellation/deletion.

Clean lockfile installs passed; backend185tests/frontend235tests31files passed; frontend typecheck/full lint/build and both repositories' changed syntax/lint/whitespace passed; four full/production audits report zero. Production Chromium passed19local-fixture scenarios/80responses at390/1440px with zero console/page errors, real browser multipart upload/Sharp/save/reload and canonical URL retention. Browser catalogue/profile/owner model/S3 send/currency/fonts/stock-image fixtures are disclosed; the versioned loopback test separately uses actual AWS SDK signed HTTP against an owned S3-wire fixture. No real R2 or Mongo persistence acceptance is implied. Generated objects/listener/browser were cleaned and closure read back; generated fixture TLS private key removed. Runbook: `docs/r2-images.md`; executed source hashes, verifier archive and limitations: `docs/r2-images-evidence.json`. Independent backend/frontend specifications and documentation/provenance passed; integrated quality/security re-review `deleg_bb64bfd4` approved the prefix correction/source bindings/harness, and `deleg_11e7e21a` closed its sole stale-plan wording hold. The commit containing this handoff is the completed local checkpoint. A total batch deadline remains an optional deferred improvement; existing request/encode bounds and operational limits are documented. This is not permission to push/deploy/access production/provider accounts/send real messages/delete Cloudinary assets. STOP after the scoped checkpoint commits. Following checkpoints are historical, not current authority.

## Launch-readiness local checkpoint — STOP after scoped commit

The user approved the launch-readiness repair checkpoint after Phase F. This checkpoint advances backend `master` from `2fc1f1d`; its commit includes this handoff. Verified guest saved-search ownership/private paging, explicit consent, indexed/leased worker and Nairobi cadence, unknown-send safety, safe readiness CLI and dependency repairs are implemented. Existing admin password/disabled registration preserved; approved owner/recipient `zawamuproperty@gmail.com`. No push/deploy/production writes/real messages/migration/backfill/seeding authorized.

Clean npm-installed sibling copies: backend152tests PASS; frontend185tests/28files/typecheck/full lint/build PASS; full/production audits both zero. Supplementary23changedbackendJS syntax and44changedfrontendfilelint passed. Both specification reviews and independent full-stack quality/security passed/no blockers. Real Mongo8/executable Express/production Chromium run `e4539882-d033-4270-8729-daf636e13eff` passed11 gates,105 browser assertions/80 API responses; verified guest/privacy/consent, fixture owner/ordinary/anonymous boundaries, enquiries, cadence/deduplication/concurrency, unknown-quota quarantine and CLI inventory nonmutation. All owned databases dropped/read back empty; exact containers/process groups/browser closed/read back absent or disconnected. Nodemailer ESM/font/currency/images are explicit fixtures, not provider evidence. Durable results and executable hashes: `docs/launch-readiness-evidence.json`; runbook/known limits/external gates: `docs/launch-readiness.md`. Root plan/handoff/verifier bundle are local-only. STOP: only separate approval can authorize push, deployment, real SMTP/owner-account checks or timer activation. The following Phase F/older sections are historical, not current status.

## Historical Phase F

## Completed Phase F local checkpoint — STOP

Phase F is complete in the local commit containing this handoff on `master`, following E `149b87f`. Saved-search API/model/alert predicates now align purpose, free-text location, canonical/unambiguous legacy types and effective prices while preserving structured criteria. Unsupported criteria fail closed; unavailable listings remain browseable but do not generate availability alerts. Alert HTML and trusted links are hardened; monthly discounted prices include base/offer context. No migration, backfill or catalog seeding was added.

Final isolated lockfile install and backend suite:105passed,0failed/skipped; entrypoint/changed-JS syntax passed. Frontend162tests/24files and production build passed. Recorded final cross-phase production Chromium/Express/disposable Mongo acceptance:410check executions across C–F, with controlled mail/font/rate/API-failure fixtures explicitly identified. All owned databases/containers/listeners were cleaned and absence read back. Current source/test/config hashes match the executed aggregate snapshot. Independent spec and quality reviews approved; see `docs/phase-f-acceptance.md` for exact commands, review provenance, results and limitations.

Frontend typecheck retains1inherited county_coordinates diagnostic; full lint14errors11warnings, changed-file lint2inherited modal any errors/1manager warning. Lockfiles unchanged; install advisory entries backend15/frontend48 are not a production-only security audit or remediation. Public legacy saved-search ownership/privacy, scan scale and alert scheduling/duplicate-delivery risks remain documented launch gates.

STOP after both scoped local commits. Nothing pushed/deployed; no production writes or real messages. Recipient remains TBD; approved SMTP/sender/recipient, owner allowlist, trusted origins, proxy/shared abuse controls and separately authorized real-provider delivery remain required. Root plan/handoff are local-only; this repository's handoff and acceptance document are versioned. Historical status below is superseded.

## Current accepted Phase E checkpoint (supersedes all history below)

Phase E is complete in the local commit containing this handoff on `master` (D baseline `b82329a`). Public general/property enquiries persist before mail, use trusted stored context, and return receipt-only success. Owner inbox/detail/status/retry endpoints enforce current persisted-user allowlist, server paging/filters and no-store. Notifications use configured SMTP, escaped contact HTML, visitor replyTo, safe failure codes and five-attempt atomic retry leases. Stats count Available/missing legacy status rather than Featured. No migration/backfill/catalog seeding or retained-data rewrite.

Fresh parent39focused tests/syntax/whitespacePASS; explicit model/mail mocks, real Mongoose hydration. SpecPASS `deleg_b4005ebb` carrying `deleg_6903b809`; quality/securityAPPROVED `deleg_f4a7277c`, including frontend/API compatibility. Review fixes have RED→GREEN regressions. Separate real productionChromium/Express/Mongo8 acceptance131checksPASS/34browserAPIresponses, exact retry race200/409 and DB read-back. Six local Nodemailer fixture sends, fonts11/rates2 explicitfixtures, no real mail/provider operation; zero console/page errors. Owned DB dropped/readbackabsent, container removed/readbackabsent, API/browser/preview closed/disconnected. Parent independently checked source hashes and no matching container. See `docs/phase-e-acceptance.md` for exact commands/provenance and cleanup.

STOP before Phase F for explicit approval. Final full cross-phase gate deferred. No push/deploy/production changes/real messages. Recipient/SMTP/sender/owner/site-origin/proxy/shared limiter configuration and live-provider delivery remain launch gates, along with baseline frontend/dependency/saved-search privacy debt. F must align alert matching and escape legacy alert HTML before enabling it. No workers/reviews remain. Root plan/docs are local-only; child handoffs/acceptance docs versioned. Entries below are historical, not current status.

## Accepted checkpoint — final status

Phase D complete in the commit containing this handoff. Spec PASS `deleg_e582a712`; quality APPROVED `deleg_0bbc8297` carrying `deleg_9a36119e`/`deleg_c8d3c295` after availability fixes. Backend25focused viewing/access tests/syntax/whitespacePASS. Missing status alone defaults Available; null/empty/unknown fails409/no insert and public badgeUnavailable; owner edit requires explicit correction. Frontend final61focused tests/build/lintPASS,3original app typing errors. Real browser/API/Mongo66assertionsPASS/10browserAPIresponses preceded the final owner-form-only repair, freshly covered by focused tests, not a browser rerun. All disposable resources cleaned. No pending workers/reviews, push/deploy/messages/production/migration.

User explicitly approved E; begin after both D commits/clean-state read-back. E retains its own checkpoint; STOP before F. Recipient/SMTP/final acceptance remain rollout gates. Final aggregate deferred; root plan/docs local-only.

## Current Phase D checkpoint (supersedes historical entries)

User approved D only. Availability controller and focused tests implemented; specification PASS `deleg_e582a712` carrying integrated `deleg_542766df`. Final quality/security review `deleg_9a36119e` pending; no Phase D commit yet. Branch `master` starting at `0de20ac`; frontend `main` starting `6627614`. Finish scoped commit then STOP before E. No push/deploy/production changes/messages/migration/backfill/catalog seeding.

Public viewing submission returns404 missing,409Sold/Rented/no insert; legacy missing availability allowed; title derived from persisted property. Historical appointment management unchanged. Final `node --test test/viewing-availability.test.js test/admin-access.test.js`:24PASS, no failures/skips (explicit model mocks); controller syntax/whitespacePASS. No backend build/typecheck/lint scripts exist.

Separate real Express/Mongo8+productionChromium acceptance54assertionsPASS,7browser APIresponses, one expected real stale-page409. Direct HTTP available/legacy viewing persistence, sold/rented no-insert409, legacy property unchanged and existing general contacts persisted. Browser stale submission after actual disposableDB status update preserved inputs and appointment count. Rates/fonts fixture only; no SMTP/upload/WhatsApp send. Final result TMPDIR `zawamu-phase-d/acceptance-7d757913841fbe4f/result.json`; DB dropped/readbackempty, disconnected, API/preview/browser stopped, exact container removed/readbackabsent. See `docs/phase-d-acceptance.md` and sibling frontend doc. Final full cross-phase suite deferred.

Quality verdict/final docs/exact-path commit pending. E/F remain unstarted. Owner allowlist, notification recipient/SMTP, saved-search contract/privacy gaps, inherited advisories/frontend baseline debt remain rollout gates. Root plan/docs local-only.

## Current checkpoint
Phase B complete, verified and independently approved: specification PASS (`deleg_5405a0b6`), quality APPROVED (`deleg_f1e31537`), concurrency fix re-review APPROVED (`deleg_de2b2645`, independently reran65/65 tests). Branch `master`, previous checkpoint `d04522b`; the commit containing this handoff is the Phase B checkpoint (`git log -1 --oneline`). STOP before Phase C and wait for explicit approval. User removed migration: no migration scripts, backfill or feature-catalog seeding. No push, deployment, production data changes or real messages authorized.

Property rules/schema/API now enforce sale/rent types, compatible availability, positive finite price and bounded decimal offer, derived decimal half-up effectivePrice, strict writable fields and merged partial validation. Optimistic concurrency rejects stale saves with 409. Legacy raw reads project defaults/location fallback without writes; explicit edits retain structured fields and image/feature snapshots. Feature catalog has public reads and persisted-owner creation, unique normalized keys and race recovery. No frontend changes or later phases started.

Fresh evidence: baseline36 tests; final backend `npm test`65 passed,0 failures/skips; syntax12 changed JavaScript files PASS; whitespace PASS. Tests use identified storage mocks. Separate parent scratch acceptance exercised real HTTP/MongoDB8.0:21 checks PASS before cleanup, including eight parallel duplicate feature creates, DB read-back, legacy GET unchanged/edit preservation and stale VersionError. Dedicated tmpfs DB dropped/read back empty, HTTP closed/disconnected, owned containers removed and absence checked. No build/typecheck/ESLint scripts exist in backend; syntax is not their equivalent. Final full cross-phase acceptance remains deferred. See `docs/phase-b-acceptance.md`.

Remaining: Phase C forms, D public display/viewing/WhatsApp, E enquiries/mail/inbox, F saved searches/final acceptance; all require approval. Existing saved-search privacy gaps, SMTP defects/recipient TBD, dependency advisories and frontend baseline debt remain. Unknown historical types stay readable but need correction when edited. No automatic catalog import; uniqueness requires the declared Mongo index (exercised on disposable DB). Not production launch approval.

Quality `deleg_f1e31537` APPROVED. Its conditional versionless-record concurrency edge was fixed with an explicit missing-__v predicate; final real HTTP/Mongo check now24 checks PASS, including synchronized competing versionless edits returning200/409 and persisted compatible state/version1. Targeted follow-up review `deleg_de2b2645` APPROVED after checking generated Mongo filter/update. **Pre-deploy Phase C gate:** existing frontend editor spreads the whole response into PUT; it must switch to editable-only payloads before deployment. No backend-only deployment compatibility is claimed.

## Historical Phase A handoff (superseded status/authorization below)

## Status
Phase A scoped checkpoint complete and independently approved. Branch `master`, baseline `1a76a79`; the commit containing this handoff is the checkpoint (`git log -1 --oneline`). **STOP: wait for explicit Phase B approval.**

## Implemented
- `src/app.js` exports Express without environment/database/listener startup. `src/index.js` owns startup.
- Current persisted user email + private ADMIN_EMAILS determines owner access. JWT/client capability claims alone never authorize.
- Protected property writes, admin stats/activity, viewing management, blog writes, upload before multer, analytics, and saved-search administrative match/email trigger. Public browse/contact/viewing submissions remain open.
- Login/profile explicit DTO `{ id, name, email, isAdmin }`; ordinary login retained; public registration stays disabled.
- Node test harness and explicit disposable Mongo acceptance runner with canonical outside-repository fixture paths, private exclusive files, empty-target checks, explicit cleanup ownership and guaranteed disconnect attempt.

## Evidence and freshness
- Last complete backend suite before final verifier-only cleanup repair: `npm test`, **31 passed**, no failures/skips.
- Final focused post-repair command: `node --test test/verification-safety.test.js`, **15 passed**. Five new subprocess regressions use a clearly identified test-only mocked Mongoose preload; no network/database/listener opens. They cover discovery/nonempty/disconnect/seed/drop failures. Parent reran and confirmed.
- Earlier real disposable Mongo/HTTP acceptance: **59 assertions**, **15 management endpoint** denial pairs, login/DTO, owner property writes with DB read-back, public contact/viewing persistence, stored-email revocation/deleted actor denial. App src has not changed since this run; the verifier cleanup-only repair was checked with focused no-DB regressions, not another full/integration pass.
- Actual production entrypoint connected to disposable Mongo, root200 and anonymous admin401.
- Syntax checks and `git diff --check` passed on final verifier files.
- Initial spec review path-containment issue fixed and re-reviewed PASS. Initial quality review cleanup-ownership issue fixed with RED11pass4fail -> GREEN15pass. Final targeted r3 spec/security re-review APPROVED with no remaining blocking concerns; parent confirmed the reviewed source hashes.
- All owned test servers/container/networks removed; fixture DB drop, released ports and deletion of both private scratch credential files were read back. No production data or real notification/media service used.

## Checkpoint rule
Only Phase A is authorized. Commit the scoped Phase A changes in both repositories, then STOP for explicit user approval before Phase B. Do not push, deploy, migrate production, change retained data, or send real messages.

User clarification: retain per-phase commits/approvals and focused verification; the final full cross-phase test pass is after all phases. Do not confuse recorded Phase A evidence with acceptance of unfinished product features.

## Remaining product phases (not started)
- B: property contract, reusable-feature API, backward compatibility, additive migration preparation.
- C: owner property forms and reusable feature picker/create interaction.
- D: public rental filters/prices/offers/status labels, availability enforcement, WhatsApp.
- E: persisted general/property enquiries, notifications and protected owner inbox.
- F: saved searches/alerts, rollout preparation and final full test pass.

Monthly rentals; free-text location; one unit per listing; reusable owner-created features; percentage sale/rental discounts; Sold/Rented remains visible, blocks viewings but allows enquiry/WhatsApp; company WhatsApp +254711168716. Notification email remains TBD.

## Remaining risks / no launch approval
- Frontend retains 3 original app type diagnostics and 29 lint errors / 11 warnings (baseline 30/11). No exclusions or rules were suppressed.
- Production audits report inherited advisory package entries: backend12 (2critical/9high/1moderate), frontend35 (2critical/24high/8moderate/1low). No broad dependency repair occurred.
- User saved-search email lookup/ID access/modification remains public; its legacy ownership/privacy gap is deferred, not fixed by Phase A.
- Existing simulated Contact UI, email transport defects/unconfigured SMTP, missing enquiry inbox, placeholder settings, and later property functionality remain work for later phases.
- Backend-only ADMIN_EMAILS must name approved existing accounts before deployment; empty/unset denies all owner access. Public registration remains disabled. Do not expose this allowlist through VITE variables.

## References
- `AGENTS.md`: phase and engineering rules.
- `docs/phase-a-baseline.md`: unchanged measured baseline.
- `docs/phase-a-acceptance.md`: commands, evidence layers, review and cleanup details.
- Workspace root plan: `.hermes/plans/2026-11-19_042648-client-property-updates.md` (local coordination artifact, not inside either Git repository).
