# Phase F — Local acceptance and release boundaries

## Checkpoint scope

Phase F was explicitly approved after backend `149b87f` and frontend `7fa3e4c`. This checkpoint aligns saved-search criteria, result replay, matching and alert mail; documents coordinated rollout/rollback; and runs the final local cross-phase verification. The commit containing this document is the scoped checkpoint. Nothing was pushed or deployed. No production data, real SMTP recipient, upload or WhatsApp message was used. No migration, backfill or catalog-seeding tooling/job was added.

Saved searches now carry free-text location, optional sale/rent purpose, canonical property types, effective-price ranges and existing room/search/structured-location criteria. Exact legacy apartment/land/office aliases are retained; house/commercial remain literal types rather than inferred categories. Missing structured/count fields fail constrained searches; county `all` remains the historical no-county restriction. Unknown/malformed criteria fail closed. Saved browse results retain unavailable listings; new alerts require available status. Alert HTML is escaped and links use the trusted site origin. Monthly prices retain base/offer context. Frontend replay preserves hidden legacy maximum bounds and uses the shared price/location/badge presentation.

## Fresh aggregate commands

Executed in fresh isolated sibling-repository copies of the final worktree, including untracked source/tests, without project `.env` files. The script copied the lockfiles, installed independently and recorded per-file SHA-256 bindings; original worktrees/dependencies were not mutated.

| Command | Result |
|---|---|
| Backend `npm ci` | PASS |
| Backend `npm test` | 105 passed, 0 failed/skipped |
| Backend `node --check src/index.js` | PASS |
| Frontend `npm ci` | PASS |
| Frontend `npm test -- --run` | 162 passed in 24 files |
| Frontend `npm run typecheck` | FAIL: one inherited `src/components/ui/location-selector.tsx:159` county_coordinates diagnostic; config typing passed |
| Frontend `npm run lint` | FAIL: 14 inherited errors, 11 warnings |
| Frontend `npm run build` | PASS; existing chunk-size/Browserslist warnings |
| Parent syntax checks on all 5 changed/new backend JS files | PASS |
| Parent changed-file ESLint | 2 inherited save-modal any errors, 1 existing manager hook-dependency warning; no new findings |
| Parent `git diff --check` in both repositories | PASS |

Pre-edit baseline: backend91/frontend148 tests passed; frontend typecheck had3diagnostics and lint14errors11warnings. Removing the touched manager's duplicate maxPrice declaration removed two typing diagnostics. No rules were suppressed or unrelated source excluded. npm ci reported full-tree advisory package entries backend15/frontend48 (not production-only audit totals); manifests and lockfiles were unchanged, and no dependency remediation is claimed. npm12 blocked dependency lifecycle scripts by its existing allowScripts policy; tests and production build nevertheless executed successfully with installed platform binaries.

Aggregate script: `$TMPDIR/zawamu-phase-f-clean-gate.py`. Full logs and per-file source hashes: `$TMPDIR/zawamu-phase-f-clean-5n64vjf8/clean-gate-result.json`. Both copies reported sourceUnchanged=true at completion. Subsequent changes were documentation-only. These are actual clean-install suite/build results, not substitutes for browser integration or provider delivery.

## Independent reviews and regression repairs

- Backend specification PASS `deleg_a7396c45`; quality APPROVED `deleg_1cce08d0`, carrying `deleg_0e715175`. Parent final focused saved-search/contact-mail run19PASS.
- Frontend specification PASS `deleg_ef248008`, carrying `deleg_9dfc95c3`; quality/security APPROVED `deleg_42a899c0`. Parent final focused run35PASS across helper/matcher/manager/Listings/PropertyPrice tests; reviewers separately ran bounded suites.
- Confirmed findings were repaired with observed failing regressions first: monthly/base/offer alert context; Mongo operator/dotted criteria validation bypass; legacy county sentinel; hydrated missing room counts mistaken for persisted zero; explicit null purpose/advertised-price fallback. Shared price handling now treats a present invalid/null API projection as authoritative unavailability and calculates only when absent.
- UI/API/model-method and SMTP fixtures are explicit mocks. Mongoose hydration probes exercise real document behavior without a DB; the separate runtime run below proves persistence and composition.

## Final production-browser / Express / Mongo acceptance

Command: `node "$TMPDIR/zawamu-phase-f-final/run-final-acceptance.mjs" --execute --source-stable`.

| Runtime stage | Checks | Observed API responses |
|---|---:|---:|
| C owner create/edit/features | 116 | 44 |
| D public browse/prices/availability/WhatsApp draft | 66 | 10 |
| E public contact/owner inbox/notification retry | 131 | 55 |
| F saved-search create/preview/replay/matching/alerts | 97 | 12 |
| Total check executions (not unique test cases) | 410 | 121 |

All four stages passed using actual isolated production Vite builds, Chromium, the exported Express app and uniquely owned loopback-only Mongo8 tmpfs containers/databases. C includes two injected API failures; its44observed responses include42real and2mocked. D contains one expected stale-availability409 browser-console resource error; authorization/validation negatives elsewhere were expected. No unexpected console/page errors were reported. Browser fonts and currency rates were deterministic fixtures, and synthetic listing-image URLs are not real media/provider acceptance.

E persisted3submissions with23seeded contacts, read back26final contacts, exercised owner paging/status/retry and anonymous/ordinary denials, and made6controlled mail-stub calls. F persisted and replayed criteria, compared browse/model/API results, matched2listings, excluded unavailable alerts, made1controlled alert mail call for1available property, read back counters1/1 and lastAlertSent, and left the Sold search counter0. No real SMTP/provider email was sent. WhatsApp hrefs were checked without sending a message.

Runner result: `$TMPDIR/zawamu-phase-f-final-run-l3Ff68/runner-result.json`.

Detailed results:
- C `$TMPDIR/phase-c-acceptance-mwnmph1m-7d8c1043fc1f14/result.json`
- D `$TMPDIR/zawamu-phase-d/acceptance-4a6ec83131a94152/result.json`
- E `$TMPDIR/zawamu-phase-e-acceptance-aZYTTv/result.json`
- F `$TMPDIR/zawamu-phase-f-acceptance-fjAuCc/result.json`

Parent parsed these actual schemas, reconciled410/121totals, and independently inspected all four exact container IDs as absent. All owned DB drops were acknowledged/read back absent; browser/API/preview/Mongo listener shutdown and disconnection were recorded. Earlier attempts remain historical scratch evidence: obsolete D guard expectations and F fixture/auth/selector setup were corrected in the harness, not by weakening application assertions or editing repository code.

Parent independently reproduced E/F tree hashes before documentation closure: backend `23010259dad43dffbd9083cca1db775562b71b2fd95c7619b9d1179512fd4c32`, frontend `d82d49b9ddd03673a063ddf3197ced00208fc31af5e9d032b67d5325ba8fdba4`. The runner uses a different deterministic ordering and separately records equal before/after full-tree snapshots. Both algorithms exclude environment/dependency/build artifacts. Final F screenshot was inspected: filters, retained summary, monthly discounted prices, Available/Rented badges and viewing guards were readable without visible overlap; fixture images are not a production-media proof.

Final read-only closure review `deleg_57586e5d` PASS: no blocking security/logic/scope findings. Parent rechecked source/test/config hashes against the clean-install snapshot, staged whitespace and exact container absence. Nonblocking note: an old saved county `all` can still appear as an area in an alert summary although matching correctly treats it as unbounded. Stale root-plan review/runtime status was reconciled before commit; no application code changed after acceptance.

## Remaining launch gates — STOP

Local Phase F acceptance is not launch/security/provider approval. Recipient remainsTBD; approve and configure actual recipient/sender/SMTP, owner account allowlist, trusted website/API origin, CORS/proxy hops and shared/upstream abuse controls. Real staging delivery requires separate authorization and evidence. Do not infer approval from current site contact copy.

Public legacy saved-search email/ID CRUD/result ownership/privacy remains unresolved and must be fixed or explicitly risk-accepted before enabling live alerts. The owner-triggered GET can send mail/update counters: it is not a health check or scheduler. Frequency choices do not create a scheduler; concurrent/repeated triggers and uncertain SMTP acknowledgements can duplicate mail. Matching scans all sorted properties before filtering/pagination; validate scale before rollout. The manager preview currently shows the endpoint's first10matches; View Results exposes the full browse replay, but preview pagination metadata is not displayed (nonblocking review note). Existing typing/lint/dependency debt remains visible.

See backend README and frontend DEPLOYMENT_CHECKLIST.md for compatible-backend-first release and paired rollback preserving data/owner boundaries. No push, deploy, retained-data changes, live alert trigger or real message is authorized. Stop after the scoped local commits.
