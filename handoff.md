# Backend Handoff — Phase A

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
