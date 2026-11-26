# R2 image storage and application WebP processing

## Contract

`POST /api/upload` remains owner-only and accepts up to ten multipart `images` files. Current persisted-account email authorization runs before file parsing. Its response remains `{ "urls": ["https://media.example.com/<optional-prefix>/images/v1/<uuid>/large.webp"] }` in upload order. When `R2_PUBLIC_URL` has a path prefix such as `/assets`, that prefix is part of every stored R2 object key (`assets/images/v1/...`) and of the returned URL path. Property `images` and blog `image` remain strings; no database migration, backfill or duplicate provider fields are needed.

New uploads use only R2. The Cloudinary SDK, configuration helper and upload path are removed; there is no Cloudinary fallback. Existing saved URLs are read unchanged. Removing application integration **does not move or delete existing hosted assets or cancel an account**. Do not cancel Cloudinary while retained records still reference it. A separately approved inventory and transfer/re-upload/replacement plus database and rendered-page verification is required before complete asset/account retirement. No such operation or migration tooling is included here. Historical evidence mentioning Cloudinary remains historical.

## Variants

Every image gets a random UUID and three immutable object keys. The subsequent [HEIC/HEIF checkpoint](heic-uploads.md) adds HEVC phone-photo input without changing these outputs; its evidence is separate from the historical R2 checkpoint.

| Name | Maximum bounding box | Use |
| --- | --- | --- |
| thumbnail | 320 × 320 | Admin previews, gallery thumbnails |
| card | 768 × 768 | Property/blog/saved-result cards |
| large | 1600 × 1600 | Detail images |

These are bounding boxes, **not square crops**. Preserve aspect ratio and do not enlarge small sources. All outputs are WebP at quality80/effort4, auto-oriented before resizing. Metadata is stripped, including camera/GPS data. No unprocessed original is stored. JPEG, PNG, WebP, AVIF and single-image HEVC HEIC/HEIF raster inputs are supported; SVG, GIF, animated/multipage and corrupt/oversized inputs are rejected after actual decoding rather than trusting MIME/filename. Maximum input8MiB, decoded24million pixels, per-output encode timeout15seconds; HEIC adds a separate15second worker decode deadline. See the HEIC runbook for WASM/worker memory and orientation details. Install dependencies with npm/lockfile on the deployment platform; Sharp needs its compatible native optional packages. Do not copy a different platform's node_modules or omit optional native packages.

## Configuration

Backend-only variables: `R2_ACCOUNT_ID` (32 lowercase hexadecimal characters), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`. The endpoint is derived as `https://<account>.r2.cloudflarestorage.com`, region `auto`; credentials are explicit, never inherited from AWS discovery. Use bucket-scoped object-read/write credentials supporting PUT and compensation DELETE; do not grant account-wide administration. Keep keys in the host secret manager, not Git or any `VITE_` variable.

`R2_PUBLIC_URL` is an HTTPS **public delivery domain**, preferably `https://media.<your-domain>`, not the authenticated S3 endpoint. Optional path prefixes contain only alphanumeric/underscore/hyphen segments. A configured prefix is stored as the leading part of every R2 object key and remains in the returned public URL path (for example, `/assets/images/v1/...` maps directly to the `assets/images/v1/...` key). Configure the public domain to serve that path directly; do not rely on a CDN/path-stripping rewrite. No userinfo/query/fragment/encoded path traversal. A development r2.dev URL is supported by code but Cloudflare documents r2.dev as nonproduction/rate-limited: use a custom domain for production. The public bucket serves only website media; never upload private documents to this prefix.

Set frontend **build-time** `VITE_MEDIA_PUBLIC_URL` to the same public base. The resolver rewrites only exact owned canonical `/images/v1/<uuid-v4>/large.webp` paths beneath that base to the requested thumbnail/card/large sibling; all other/legacy/blob URLs remain unchanged. Store canonical large URLs, not presentation-derived thumbnail URLs. Missing frontend configuration safely falls back to stored URLs but forfeits size selection. Rebuild the frontend when its public configuration changes. Ordinary `<img>` delivery does not need an anonymous CORS setting; configure bucket CORS only if future browser fetch/canvas workflows require it.

`npm run check:release` checks R2 configuration without contacting providers and emits only safe check keys. It does not prove credentials, bucket permissions, public DNS, object delivery or launch approval.

## Bounds, failure handling and lifecycle limitations

One batch per API process is admitted before multipart buffering, no waiting queue; a concurrent owner request gets503/Retry-After5. Files/variants encode and upload sequentially. Multipart limits bound files, bytes and fields. A full batch can buffer roughly80MiB of compressed inputs plus decoded/native codec/output memory; this is not a constant-80MiB process guarantee. Enforce host/proxy body/time limits, reasonable process memory, appropriate owner rate limits and a shared upstream limit if running multiple processes. A stalled multipart request still needs the host's request timeout; process-local admission is not a distributed queue.

SDK requests have15second abort deadlines,3second connection timeout and at most2 attempts. Every PUT carries `image/webp` and `public, max-age=31536000, immutable`; keys are never overwritten or derived from client filenames. On batch failure, best-effort compensation DELETE covers every newly attempted key, including an ambiguous failed PUT. Safe JSON400/413 reports input limits; missing configuration/provider errors return503 without credentials/raw diagnostics. Failed compensation produces a fixed warning and503. Object storage is not transactional: network uncertainty can leave objects even after compensation, and an aborted request can still complete remotely. Reconcile orphan objects deliberately rather than claiming exact-once cleanup.

A successful upload followed by cancel/failed property save can also orphan objects. Removing a listing/image does not automatically delete storage: URLs may be shared, and no durable media-ownership/retention tracking exists. No unsafe delete-from-URL endpoint or background garbage collector is added in this checkpoint. Define retention/reference tracking before automatic GC.

## Verification and separate operational gates

See `docs/r2-images-evidence.json` for executed checks bound to source hashes. Unit/API tests use explicit model/S3 method doubles; optimizer tests exercise real Sharp codecs. `test/r2-loopback.test.js` exercises real owner multipart HTTP, Sharp, AWS SDK signed PUT/DELETE HTTP, local object byte read-back and failure compensation against a tiny owned in-memory S3-wire fixture. This is **not Cloudflare R2 acceptance**, Mongo persistence or proof of live credentials.

Before a separately authorized release: provision the bucket/custom public domain and scoped secret; verify a canary PUT/public WebP read-back/cache headers/all three variants and compensation on approved disposable provider keys; verify matched frontend/backend base and detail/card/thumbnail browser requests; record both SHAs and compatible rollback artifacts. Only then deploy with explicit approval. Keep saved legacy media accessible until an approved transfer/replacement is verified. No push, deployment, real R2 upload, production database access, Cloudinary deletion or account cancellation occurs in this local checkpoint.
