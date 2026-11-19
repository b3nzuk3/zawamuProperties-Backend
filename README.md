# Zawamu Properties Backend

This is the backend API for Zawamu Properties, built with Node.js, Express, and MongoDB.

## Features

- User authentication (login, JWT; public registration disabled)
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

Read `AGENTS.md`, `handoff.md`, and the phase acceptance documents in `docs/`. Phases A–F have reached the local checkpoint; no push, deployment or live-message operation is authorized by that checkpoint.

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

Phase B added the property/feature backend contract; C added owner forms; D added public presentation and availability-based viewing rejection; E added enquiries/mail/inbox; F aligned saved searches/alerts and recorded final local acceptance. **Migration was removed by the user:** no migration script, historical-record backfill, or automatic feature-catalog seeding is required. Existing property feature snapshots remain independent of the catalog.

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

### Phase F: saved-search criteria and alerts

`POST /api/saved-searches` and plain-object `PUT /api/saved-searches/:id` accept `searchCriteria` with optional `location`, `listingPurpose` (`sale`/`rent`), `propertyTypes`, `minPrice`/`maxPrice`, `minBedrooms`/`maxBedrooms`, `minBathrooms`/`maxBathrooms`, `searchTerm`, and retained `county`/`constituency`/`ward`. Criteria are validated without string-to-number coercion: finite non-negative bounds, minimum not greater than maximum, bounded trimmed text, and no unknown fields. Replace the complete criteria object when changing it; dotted/operator updates are rejected. An explicit zero bound is active, not omitted.

- Free-text location and search term match case-insensitive literal substrings, not regular expressions. Owner-entered location takes precedence; legacy missing location is synthesized on read only. Purpose missing on a legacy property reads as sale.
- Supported new type spellings are Apartment, Bungalow, Townhouse, Land, Maisonette and Office space. Historical `apartment`, `land`, `office` map only to their unambiguous canonical equivalents. Historical `house` and `commercial` remain exact literal legacy types: they do not mean every home or Office space. Replace ambiguous searches explicitly rather than inferring intent or backfilling data.
- Retained county/constituency/ward constraints match case-insensitive complete field values and independently require those property fields. A manually located listing missing structured metadata does not satisfy an old structured search. Historical county `all` means no county restriction; any constituency/ward restriction still applies.
- Price ranges use the same decimal-rounded effective discounted price as browse, not the undiscounted base amount. A bound on bedroom/bathroom counts requires a finite stored count. Missing bounded data fails closed.
- `GET /api/saved-searches/:id/properties?page=1&limit=10` uses the same model predicate before pagination and returns serialized effective prices/read-time defaults. `limit` is capped at 100. Saved results retain Sold/Rented visibility; new-property email alerts exclude them and unknown/null availability. Only absent legacy availability defaults Available.
- Exact semantic parity currently requires an application-side scan of sorted property candidates before pagination; this is not an indexed high-volume search solution. Size/load validation is a rollout consideration. There is no automatic data rewrite.
- Alert HTML escapes dynamic content, restricts image URLs to HTTPS, and builds listing/dashboard links from trusted `FRONTEND_URL`. Rental amounts are discounted monthly KES values with base/offer context. Invalid origin or SMTP configuration returns a safe notification failure, not simulated delivery success.

### Release preparation and Phase F boundaries

Phase F is authorized for local implementation and disposable-fixture verification, not deployment. Follow the sibling frontend `DEPLOYMENT_CHECKLIST.md` for the coordinated release and rollback gates. Record both repository SHAs and retain legacy structured property fields; release the compatible backend before the frontend. No migration, historical backfill, feature-catalog seed or destructive cleanup is part of this release.

The enquiry recipient remains **TBD**. Before an approved rollout, configure the existing owner account allowlist, trusted website origin, SMTP sender/credentials and approved business recipient. Separately authorize and verify actual staging-provider delivery; unit transport mocks and a saved inbox record cannot satisfy that operational requirement. Validate proxy hops and shared/upstream abuse controls for the deployed topology.

Saved-search administration still has a pre-existing privacy/ownership gap: user email/ID lookup and update/delete routes are public. The current scope aligns criteria, not account authorization or subscriber email verification. Do not describe saved-search results as private or enable live alerts until the associated privacy/abuse risk is resolved or explicitly approved. Only the match/email management trigger requires the persisted allowlisted owner. It is `GET /api/saved-searches/admin/check-matches?hoursBack=24`; despite its HTTP method it may send mail and update counters, so never call it against retained data as a health probe. No scheduler is installed by this code; persisted frequency settings are not proof of automatic cadence. Repeated/manual or concurrent triggers and SMTP acknowledgement failures may duplicate delivery; counters are not an exact-once queue.

Frontend typing/lint baseline debt and inherited dependency advisories remain separate launch gates. Local final acceptance records must distinguish real Mongo/HTTP/browser execution from transport fixtures and unexecuted provider/deployment checks. Application rollback must preserve the owner boundary and stored enquiry/property/search records; disable incompatible old saved-search consumers rather than silently broadening new criteria.

### Phase D: viewing availability

Public `POST /api/viewing-requests` still accepts anonymous visitors. Missing properties return 404; Sold/Rented properties return 409 without creating an appointment. Only missing or explicitly `available` status permits viewings; null/empty/unknown historical values fail closed with 409. Legacy listings with missing availability retain Available read compatibility. Existing viewing requests and owner management are not deleted or automatically cancelled when a listing becomes unavailable. General contact submission remains separate and permitted; email/inbox work is not included in Phase D.

## Phase E: enquiries, notification delivery, and owner inbox

`POST /api/contact` remains public and accepts `{ name, email, message, phone?, subject?, interest?, source?, propertyId? }`. `source` defaults to `general` for existing callers; property enquiries require a valid `propertyId`. The server looks up the stored property title and constructs `propertyUrl` from the configured trusted `FRONTEND_URL`; client-supplied title/URL fields are rejected. Sold/Rented listings still accept enquiries. Inputs are trimmed, length-limited and validated. The API persists first and returns only `{ "message": "Your enquiry has been received.", "received": true }` with HTTP 201. Mail/configuration failure does not discard the saved enquiry or falsely claim email delivery.

Owner-only inbox API (current persisted user email must match backend `ADMIN_EMAILS`):

- `GET /api/contact?page=1&limit=20&status=new|read|resolved&source=general|property` returns `{ items, total, page, limit, pages }`.
- `GET /api/contact/:id` returns one owner DTO.
- `PATCH /api/contact/:id` accepts only `{ "status": "new" | "read" | "resolved" }` and returns the updated DTO.
- `POST /api/contact/:id/retry-notification` retries a pending/failed or expired-lease notification; it returns the DTO on claim/successful state recording and `409` when already sending, sent, or at the attempt cap.

Each owner DTO contains only `_id`, `name`, `email`, `message`, `phone`, `subject`, `interest`, `source`, `propertyId`, `propertyTitle`, `propertyUrl`, `status`, `notification`, and `createdAt`. `notification` exposes `status` (`pending`, `sending`, `sent`, `failed`), total `attempts`, `lastAttemptAt`, and a safe `lastError` code. Inbox responses use `Cache-Control: no-store`. Legacy contact documents read as general/new/pending/zero attempts without a read-time database write.

Contact notification delivery uses Nodemailer `createTransport` and backend-only `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, optional paired `SMTP_USER`/`SMTP_PASSWORD`, `SMTP_FROM`, and the approved `CONTACT_NOTIFICATION_EMAIL`. That recipient is still a launch approval gate; do not infer it from existing site copy. Configure a valid `FRONTEND_URL` HTTPS origin (localhost HTTP is accepted only for local development). If it is missing or invalid during property submission, the receipt keeps the submission-time `propertyUrl` as null and delivery remains retryable; after correcting configuration, an owner retry reconstructs the email link from the persisted `propertyId` and current trusted origin without rewriting that snapshot or trusting a historical saved URL. The stored property title remains the notification snapshot. HTML mail escapes visitor-provided content and sets the configured sender plus visitor `replyTo`. No credentials or provider diagnostics are returned/logged. Missing or invalid mail configuration is recorded as `notification_not_configured`; SMTP errors are recorded as `delivery_uncertain` because a transport failure cannot prove that the remote server did not accept a message.

Delivery attempts are claimed atomically in MongoDB and capped at five total attempts, including the initial send. A two-minute lease blocks concurrent claims; an expired lease may be recovered. SMTP is not transactionally idempotent: if the process/connection fails after the mail server accepts a message but before the sent state is stored, a later retry can duplicate the email. The lease prevents simultaneous attempts but cannot remove that distributed-delivery uncertainty. The limiter permits 10 submissions per 15 minutes per resolved client IP in each API process; its in-memory counter resets on restart and is not shared across instances, so multi-instance deployments also need an upstream/shared rate limit.

`TRUST_PROXY_HOPS` defaults to `0`. If deployed behind reverse proxies, set it to the exact fixed number of trusted hops (0–10); every trusted proxy must overwrite/append forwarding headers correctly, and the backend should not be directly reachable by untrusted clients. Do not use blanket `trust proxy=true`. Wrong hop counts can let callers spoof rate-limit client IPs. SMTP/recipient configuration, the real proxy chain, multi-instance abuse protection and actual provider delivery remain deployment gates. Focused automated tests use explicit model/mail mocks and loopback HTTP; separate disposable-Mongo/browser persistence/concurrency evidence is recorded in `docs/phase-e-acceptance.md`. Saved-search alert HTML hardening was implemented and locally reviewed in Phase F; documented privacy/abuse, configuration and real-delivery gates still block enabling live alerts without separate approval.

- Deploy to [Render](https://render.com/), Heroku, or any Node.js host.
- Set environment variables in your host dashboard.

## License

MIT
