# Agent Instructions — Zawamu

## Checkpoint contract (user instruction)
- Work one approved phase at a time. **Phase D is authorized and in progress. Complete its verify/review/commit checkpoint, then STOP before Phase E for renewed approval. Migration was removed by the user; do not add migration tooling, backfill, or catalog seeding jobs.**
- Every phase is a checkpoint: implement, perform scoped verification, review, update handoff, commit its scoped changes, then STOP and wait for explicit user approval before starting the next phase.
- User clarification: keep phase checkpoints/approvals; run the final full cross-phase test pass after all phases. Do not repeatedly run that final aggregate gate at intermediate checkpoints.
- Do not push, deploy, change production data, send real messages, or start Phase E without separate approval.
- Preserve unrelated work. Inspect status/diffs before editing and stage exact paths only.

## Workspace
- `zawamuProperties-frontEnd/`: React 18/TypeScript/Vite/shadcn/Tailwind; Git branch initially `main`.
- `zawamuProperties-Backend/`: Node ESM/Express/Mongoose; Git branch initially `master`.
- Parent workspace is **not** a Git repository. Commit each child repository separately; do not initialize a parent repository.
- Approved product plan: `.hermes/plans/2026-11-19_042648-client-property-updates.md` at workspace root. The root plan and workspace docs are local coordination artifacts; child repository instructions/handoffs are versioned.
- Read `handoff.md`, repository README and relevant source before continuing. Current code is authoritative; historical findings may be stale.

## Phase boundaries
A. Baseline, test harnesses, owner access boundary.
B. Property data contracts and feature API; read-time compatibility only, no migration.
C. Owner property forms and reusable features.
D. Public filters/pricing/labels, availability enforcement and WhatsApp.
E. Real general/property enquiries, email and owner inbox.
F. Saved searches/alerts, rollout preparation and final acceptance.

## Engineering and verification
- Use npm with `package-lock.json`; frontend's historical bun lock is not the current runner. Do not broadly upgrade dependencies.
- Backend: export the Express app without connecting/listening; only startup opens MongoDB. Tests must never load a production database.
- Owner authorization is server-side, based on the current persisted user's email and `ADMIN_EMAILS`; JWT identity or a frontend flag alone is not sufficient.
- Keep public browse and contact/viewing submission accessible. Keep existing registration routing disabled; do not enable registration for tests.
- Add regression tests for anonymous, ordinary authenticated, and allowlisted owner access. Fail closed if owner configuration is absent.
- Document remaining legacy access gaps honestly; do not expand this phase into a full auth rewrite.
- Capture baseline failures before edits; do not suppress rules, exclude existing source, or fabricate results to obtain green checks. Test mocks must be identified as mocks.
- After final source/test/config edits rerun tests, build, typecheck, changed-file lint and `git diff --check`; report unrelated baseline failures separately.
- No secrets in source, logs, commits or handoff. Use only explicitly disposable test infrastructure for persistence checks.

## Confirmed product constraints for later phases
Monthly rentals; free-text locations; inline-create reusable features; company WhatsApp +254711168716; discounts for sales/rentals; one listing per unit; Sold/Rented remains visible, blocks viewings but permits enquiries. General and property enquiries must persist and notify by email. Recipient remains TBD.

## Repository scope
Backend repository. Paths prefixed by the other repository name belong to the sibling workspace and must not be edited by a worker assigned only here.
