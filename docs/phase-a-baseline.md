# Phase A — Measured pre-change baseline

Measured 2026-11-19 before application edits, after lockfile installs. Runtime: Node `v26.12.0`, npm `12.2.1`.

| Repository / command | Result |
|---|---|
| Backend (`master`, `1a76a79`): `npm ci --no-audit --no-fund` | PASS |
| Backend: `node --check src/index.js` | PASS |
| Frontend (`main`, `b9e531b`): `npm ci --no-audit --no-fund` | PASS |
| Frontend: `npm run build` | PASS; Vite chunk-size and outdated Browserslist warnings |
| Frontend: `npm run lint` | FAIL: **30 errors, 11 warnings** |
| Frontend: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json` | FAIL: **3 diagnostics** |
| Frontend: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json` | PASS |

No test runner/scripts or suites existed in either repository. Original installs completed without lockfile changes. npm reported blocked optional postinstall scripts; the original production build nevertheless completed successfully. Do not approve arbitrary install scripts to silence this warning.

## Existing application type errors

```text
src/components/ui/location-selector.tsx(159,31): TS2339 Property 'county_coordinates' does not exist on type 'County'.
src/components/ui/saved-searches-manager.tsx(60,5): TS2300 Duplicate identifier 'maxPrice'.
src/components/ui/saved-searches-manager.tsx(61,5): TS2300 Duplicate identifier 'maxPrice'.
```

## Existing ESLint errors (30)

- `src/components/home/FeaturedListings.tsx`: 2 explicit-any errors.
- `src/components/home/LatestBlog.tsx`: 4 explicit-any errors.
- `src/components/ui/command.tsx`: empty-interface error.
- `src/components/ui/save-search-modal.tsx`: 2 explicit-any errors.
- `src/components/ui/textarea.tsx`: empty-interface error.
- `src/pages/Admin.tsx`: 8 explicit-any errors.
- `src/pages/AdminProperties.tsx`: 8 explicit-any errors.
- `src/pages/AdminViewingRequests.tsx`: 1 explicit-any error.
- `src/pages/Listings.tsx`: 1 explicit-any error.
- `src/pages/Login.tsx`: 1 explicit-any error.
- `tailwind.config.ts`: require-import error.

Warnings are existing React Refresh exports (8) and hook dependencies (3), including `useAuth.tsx`. Phase A must not weaken these rules or hide the source to claim a clean result. Changes may remove an existing diagnostic in a touched file; final checks must introduce no new error.

## Historical observation correction

An unused `register` controller is present, but `src/routes/auth.js` deliberately does not expose registration. Phase A preserves this and tests ordinary fixture accounts without enabling public registration.

The plan and this baseline describe the starting state, not current completion. See `handoff.md` for fresh checkpoint evidence and remaining work.
