# Phase E scoped acceptance — complete local checkpoint

Backend `master` baseline `b82329a`; sibling frontend `main` baseline `ee4807e`. The commit containing this document is the Phase E backend checkpoint. No push/deployment/production changes/real messages. Migration removed; no backfill or catalog-seeding jobs. STOP before F.

## Fresh focused evidence

Parent executed `node --test test/contact-api.test.js test/contact-mail.test.js test/admin-stats.test.js test/admin-access.test.js`: **39 passed, zero failures/skips** after final repair. These use explicitly mocked model methods/mail with real loopback HTTP; hydrated Mongoose documents are tested without a database. Parent syntax checked15E JavaScript files before review and freshly checked the affected final source/tests after repairs; whitespace PASS. No backend build/typecheck/ESLint scripts exist; syntax is not their equivalent. Existing Cloudinary configuration warning remains (uploads untested/out of E).

## Review and repair

Specification PASS `deleg_b4005ebb` carrying full `deleg_6903b809`; quality/security APPROVED `deleg_f4a7277c`, including bounded frontend/API compatibility review, independently39tests/whitespacePASS. Review repaired missing-origin retry recovery, title-limit mismatch and CORS-on429 with observed RED→GREEN regressions. Parent additionally observed/fixed hydrated-document copying: `toObject()` preserves mail fields before creating a derived URL copy. No stored snapshot is rewritten. Receipt-only persist-before-mail, current persisted-owner access, five-attempt atomic leases and redacted mail state are verified. Earlier35/38counts are superseded, not cumulative.

## Real scoped runtime acceptance

Scratch harness `acceptance-core.mjs` executed against an isolated production frontend build, actual Express app and owned MongoDB 8 tmpfs container: **131 checks PASS**, 34 real browser API responses (31 HTTP 200, three HTTP 201), zero console/page errors. General and Sold/Rented property enquiries produced three real persisted contacts; stored title/ID/trusted link and notification states were read back. Anonymous/ordinary inbox API and route access denied; actual owner login, paging/source/status filters, detail, status mutation/read-back and retry worked. Legacy raw contact remained unchanged. Concurrent retries returned exactly one200/one409, incremented once, stopped at five attempts, and never inserted duplicate contacts. Five390px geometry checks had no page/control overflow.

Mail was an explicit Nodemailer transport fixture: six factory/send calls (one success, four failures, one held barrier failure), two property-context payload checks, and a separate absent-SMTP scenario. This proves application behavior, not real provider delivery. Font CSS11 and exchange rates2 were explicit fixtures; other external requests0. Seeded23 + submitted3 = final26 records. No external email, WhatsApp send, production data access or upload.

Final report: `$TMPDIR/zawamu-phase-e-acceptance-DXrvqC/result.json`. Parent read/aggregated it and independently matched complete source-tree SHA256 before documentation-only closure: backend `b221a50bd8bbafa6d78b3b74d7ba5a70043a95e93d3359e6fc04de8dbe86a58d`, frontend `ba726e7020230053fe6fa525949ca8c28e8829eea0520728c228346a418335d3`; frontend snapshot hash matched. These hashes precede final documentation edits; application/test/config source is unchanged.

Cleanup read-back: owned DB `zawamu_phase_e_149aa71b005773` dropped (acknowledged), zero collections and absent database listing; Mongoose disconnected, browser/API/preview closed. Exact container `zawamu-e-149aa71b005773` removed/inspected absent; parent Docker listing showed no Phase E container and acceptance listeners were absent. No workers/reviews remain pending.

## Remaining / stop boundary

Phase E is the local scoped checkpoint, not launch approval. STOP before F for explicit approval. Final full cross-phase suite remains deferred. Notification recipient approval, real SMTP/sender/connectivity, owner allowlist and trusted site origin configuration, deployment proxy topology/shared abuse controls, existing frontend type/lint/dependency debt and legacy saved-search privacy remain launch gates. F must align saved-search/alert contracts and escape existing dynamic alert HTML before enabling that flow. No migration/backfill/catalog-seeding jobs, push, deployment or real messages occurred.
