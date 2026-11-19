# Phase D — viewing availability evidence

## Accepted final checkpoint

SpecPASS `deleg_e582a712`; qualityAPPROVED `deleg_0bbc8297` carrying earlier quality reviews after owner-editor explicit-status correction. Backend25focused tests/syntaxPASS and66real browser/API/Mongo assertions are the final backend evidence; backend source unchanged afterward. Frontend owner-only helper repair followed integration and passed61focused create/edit/helper/fields/public tests/build/lint, not a claimed browser rerun. No pending review. The commit containing this document is the D checkpoint; user separately approved E, which begins only after both D commits/clean-state verification. Earlier pending language/counts below are historical and superseded.

## Final quality repair (supersedes earlier counts below)

Quality `deleg_9a36119e` found unknown/null availability accepted by the old negative check. Controller now permits only missing/`available`; explicit null/empty/unknown returns409 without insertion. Frontend badges say Unavailable rather than Available. Regressions observed RED→GREEN. Fresh backend focused viewing/access tests **25PASS**, syntax/whitespace PASS; frontend39focused/build/lintPASS, app typing3baseline errors. Real productionChromium/Express/Mongo acceptance **66assertionsPASS**,10real browser APIresponses, rates33/fontCSS8explicitfixtures, exactly1expected409resourceerror and no unexpected/pageerrors. Raw null/withdrawn/empty each denied409/no insert and rendered disabled Unavailable. Final scratch report `zawamu-phase-d/acceptance-2e56f2f35f8af16f/result.json`; all owned resources cleaned/read back; no messages/providers/production. Targeted quality re-review `deleg_c8d3c295` pending until handoff verdict. User approved E separately; finish D checkpoint commit first. Earlier54run is superseded, not cumulative.

Starting backend `master` at `0de20ac`; user authorized Phase D only. No migration, backfill, catalog seed, push, deployment, production data change or real message. Stop before Phase E after the scoped commit/review checkpoint.

## Implementation

`POST /api/viewing-requests` remains public. Missing property returns 404; Sold/Rented returns 409 before creating an appointment; missing legacy availability behaves as Available. Title is taken from the persisted property rather than trusting the visitor's title. Existing historical appointments and owner management remain unchanged. General contact stays separate and available; Phase E persistence/delivery/inbox expansion is not implemented here.

## Executed checks

- `node --test test/viewing-availability.test.js test/admin-access.test.js`: **24 passed**, no failures/skips (including nested endpoint cases). Loopback HTTP with explicitly mocked model methods; no DB connection or production `.env`.
- `node --check src/controllers/viewingController.js`: PASS.
- `git diff --check`: PASS before checkpoint documentation.
- Backend has no build/typecheck/lint script; syntax is not reported as one of those gates. Final full cross-phase suite is deferred until all phases finish.

## Separate real API/database/browser evidence

Parent scratch runner `zawamu-phase-d/acceptance.mjs` used real Express, owned disposable MongoDB8 tmpfs container, production frontend snapshot and Chromium. Final run `acceptance-7d757913841fbe4f/result.json`: **54 assertions PASS**, 7 real browser API responses. Sold/Rented direct POSTs returned409/no appointment inserted; available and raw legacy listings accepted201 and persisted appointments; legacy property read-back unchanged; existing general contact POST persisted for Sold/Rented questions. A browser loaded Available, then a disposable DB update changed it to Rented; its stale viewing submission returned real409, retained inputs, disabled repeat submit and left appointment count unchanged. Persisted-title rule is covered by unit HTTP assertions. See frontend `docs/phase-d-acceptance.md` for public surface details.

Rates (26 requests) and font CSS (5 requests) were browser fixtures; property/viewing APIs and database operations were real. Exactly one expected browser conflict resource error; no unexpected console/page errors. No SMTP, Cloudinary upload or WhatsApp send occurred. DB dropped/read back empty, Mongoose disconnected, HTTP/preview/browser stopped, exact owned container removed/read back absent.

Independent spec/quality reviews and commit recorded in `handoff.md` when complete. This checkpoint is not production launch acceptance. SMTP/notification recipient, owner allowlist configuration, saved-search privacy/contract alignment, inherited dependency advisories, frontend baseline debt and final cross-phase acceptance remain later gates.
