# Zawamu Properties Backend

This is the backend API for Zawamu Properties, built with Node.js, Express, and MongoDB.

## Features

- User authentication (register, login, JWT)
- CRUD for properties/listings
- Blog management
- Contact form handling
- Admin dashboard endpoints
- Analytics endpoints

## Getting Started

### Prerequisites

- Node.js (v18+ recommended)
- MongoDB database (Atlas or local)

### Setup

1. Clone the repository or copy the `server` folder to your backend host.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your MongoDB URI and JWT secret:
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```
4. Start the server:
   ```bash
   npm run dev
   # or for production
   npm start
   ```

The server will run on the port specified in `.env` (default: 5000).

## API Endpoints

- Public registration is deliberately disabled; provision trusted accounts through an approved administrative process.
- `POST   /api/auth/login` — Login and receive JWT
- `GET    /api/auth/profile` — Get `{ id, name, email, isAdmin }` (JWT required); login returns the same user DTO with its JWT.
- `GET    /api/properties` — List all properties
- `POST   /api/properties` — Create a property
- `GET    /api/properties/:id` — Get property by ID
- `PUT    /api/properties/:id` — Update property
- `DELETE /api/properties/:id` — Delete property
- `GET    /api/blog` — List all blog posts
- `POST   /api/blog` — Create a blog post
- `GET    /api/blog/:id` — Get blog post by ID
- `PUT    /api/blog/:id` — Update blog post
- `DELETE /api/blog/:id` — Delete blog post
- `POST   /api/contact` — Submit contact form
- `GET    /api/admin/stats` — Admin dashboard stats
- `GET    /api/analytics` — Analytics data

## Phase A: test harness and owner boundary

Read `AGENTS.md`, `handoff.md`, and `docs/phase-a-baseline.md`. Phase B is now authorized; each phase still ends at a commit/approval checkpoint before the next phase.

- `npm ci` installs the lockfile; `npm test` runs Node test-runner regressions. These use actual loopback HTTP and explicitly stub database methods; they do not connect to MongoDB or external mail/media services.
- `src/app.js` exports the Express app without connecting/listening. `src/index.js` is the production entrypoint and owns environment loading, MongoDB connection and listener startup.
- Set backend-only `ADMIN_EMAILS` to a comma-separated list of **existing trusted account emails**. Comparison trims/case-folds each exact address. Empty/unset configuration grants nobody owner access. No frontend env value, request body or JWT `isAdmin` claim grants authority.
- After a valid JWT, protected requests load the current stored user and authorize its email. Changing/deleting that account removes access even for a previously issued token. Storage failures deny access rather than falling through.
- Owner-only surfaces: property mutations, admin stats/recent activity, viewing management, blog mutations, media upload (before file parsing), analytics, and the saved-search admin match/email trigger. Property/blog reads, general contact submission and viewing submission remain public.
- General user saved-search ownership/privacy is a pre-existing separate concern and is not claimed fixed by Phase A. No full authentication rewrite, token revocation system, or role-management UI was added.
- Configure the actual owner account **before deploying**; an empty allowlist intentionally locks all admin operations. Deploy backend/frontend together to expose and consume the `isAdmin` capability consistently. Login remains available to ordinary accounts.

### Disposable real-database acceptance

`npm run verify:phase-a` requires an explicit `TEST_MONGODB_URI` pointing to `mongodb://127.0.0.1:<port>/zawamu_phase_a_<unique_suffix>`. It refuses credentials, query parameters, non-loopback hosts and nonempty databases. It never loads `.env` or falls back to `MONGODB_URI`.

The script creates temporary accounts/property/contact/viewing fixtures, exercises real login, HTTP authorization, persistence, and account revocation, then drops **only its validated disposable database** and disconnects. Destructive cleanup is enabled only after discovery proves the target empty; discovery/nonempty failures never grant ownership. Disconnect is attempted even if dropping fails. The safety suite executes these failure paths through an explicitly mocked, test-only Mongoose preload. Never point it at retained data. Supply your own isolated MongoDB container; do not reuse a production tunnel.

For browser acceptance, `--serve` keeps the disposable API alive after its assertions. Set `PHASE_A_FIXTURE_FILE` to a fresh absolute path outside the repository; ephemeral generated credentials are written privately there, never to stdout or Git. Stop with SIGINT/SIGTERM to close HTTP and drop the test database. Clean up that private file and container afterward. This is acceptance infrastructure, not a production server mode.

## Phase B: property contracts and reusable features

Phase B added the property/feature backend contract; Phase C added owner forms. Phase D adds public presentation and availability-based viewing rejection. Real enquiry/email/inbox and saved-search alignment remain Phases E/F. **Migration was removed by the user:** no migration script, historical-record backfill, or automatic feature-catalog seeding is required. Existing property feature snapshots remain independent of the catalog.

### Property contract

- Owner writes accept only declared editable fields; derived `effectivePrice`, identifiers, ownership, timestamps, and unknown fields are rejected. Updates merge the stored record and validate the complete result. Concurrent stale saves return 409; reload before retrying.
- `listingPurpose` is `sale` (default) or `rent`; rentals represent monthly prices. Sale accepts Apartment, Bungalow, Townhouse, Land, Maisonette and Office space; rent accepts the first four.
- `availability` defaults to `available`; sales also allow `sold`, rentals also allow `rented`. A purpose change must explicitly correct any incompatible status.
- `price` is a finite positive number. `offerPercent` defaults to zero, accepts 0–99.99 with at most two decimals, and applies to sale or monthly rental base price. Read-only `effectivePrice` rounds the decimal calculation half-up to two KES decimal places.
- `location` is trimmed required free text. Legacy county/constituency/ward/coordinates remain optional and readable. Missing legacy purpose/status/offer fields receive read-time defaults; missing/blank location falls back to ward, constituency, county. Reads do not write these values back. An explicit owner edit validates and saves a complete record.
- Existing features stay string snapshots; the new catalog does not rewrite or automatically import them. Unrecognized historical types remain readable, but editing requires an allowed type.

### Feature endpoints

- `GET /api/features` is public and returns an array of `{ _id, name }`, ordered by normalized name and ID.
- `POST /api/features` accepts only `{ "name": "Swimming Pool" }` and requires the existing persisted-owner authorization boundary.
- Names are trimmed, internal whitespace is collapsed, and `nameKey` uses JavaScript `toLowerCase()` with a unique index. Duplicate equivalence is equality of those normalized keys, not locale-specific collation, accent removal, or full Unicode case folding. Names must contain 1–100 Unicode code points after normalization.
- A new entry returns HTTP 201; a case/whitespace duplicate returns the original entry with HTTP 200, including after a duplicate-key race. The stored display spelling is retained.
- There are no catalog rename/delete endpoints. Removing a selection from a property does not remove the reusable catalog entry or rewrite other property snapshots.

## Deployment

### Phase D: viewing availability

Public `POST /api/viewing-requests` still accepts anonymous visitors. Missing properties return 404; Sold/Rented properties return 409 without creating an appointment. Only missing or explicitly `available` status permits viewings; null/empty/unknown historical values fail closed with 409. Legacy listings with missing availability retain Available read compatibility. Existing viewing requests and owner management are not deleted or automatically cancelled when a listing becomes unavailable. General contact submission remains separate and permitted; email/inbox work is not included in Phase D.

- Deploy to [Render](https://render.com/), Heroku, or any Node.js host.
- Set environment variables in your host dashboard.

## License

MIT
