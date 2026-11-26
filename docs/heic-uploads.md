# HEIC / HEIF phone-photo uploads

## Input and output contract

Owner `POST /api/upload` now accepts single-image HEIC/HEIF containing HEVC-compressed photos, alongside JPEG, PNG, WebP and AVIF. Detection uses decoded headers/content, not a trusted filename, extension or multipart MIME. A `.heif` file is a container, not a guarantee of a supported codec: other HEIF codecs, sequences, multiple top-level images, corrupt and incomplete files remain rejected.

Outputs are unchanged: metadata-free WebP thumbnail/card/large variants bounded at 320/768/1600 pixels with aspect ratio preserved and no upscaling. Only canonical `large.webp` string URLs are saved; no HEIC original or camera/GPS metadata is uploaded. Property/blog schemas, R2 keys, compensation and owner authorization are unchanged. There is no migration or backfill.

## Decoder and deployment

The npm lockfile pins `libheif-js@1.23.5`. The backend uses `libheif-js/wasm-bundle.js` in a fresh Node worker per HEIC image. This includes the HEVC decoder and does not require a system `heif-convert` binary or a custom Sharp build. Native Sharp optional packages are still needed for metadata inspection and WebP encoding; install on the target platform with `npm ci`, not copied `node_modules`.

HEIF item rotation/mirroring is applied by libheif. The resulting RGBA has no EXIF to rotate again. Ordinary JPEG EXIF rotation remains handled by Sharp. The synthetic rotation fixture verifies both dimensions and pixel placement. HEIF EXIF orientation alone is descriptive, not a presentation transform; a separate fixture explicitly verifies it is ignored. See [pillow-heif's excerpt of the HEIF standard](https://pillow-heif.readthedocs.io/en/latest/workaround-orientation.html): rotation metadata is ignored in presentation, while the `irot` item property determines rotation. Applying EXIF again would risk incorrectly rotating standards-compliant photos.

`libheif-js` declares LGPL-3.0. It stays a separately installed backend dependency, unmodified, and is not bundled into the frontend. Preserve its distributed license notices (package `LICENSE` and `libheif-wasm/LICENSE`) and applicable source/replacement rights when redistributing backend artifacts. Upstream source: <https://github.com/catdad-experiments/libheif-js>. This checkpoint is not a patent/legal opinion about codecs or distribution.

## Resource and failure bounds

- Existing maximum 8 MiB compressed input, 24 million decoded pixels, ten files per request and one active upload batch per API process remain.
- Sharp checks header dimensions before HEVC decode. The isolated decoder checks its own transformed dimensions before allocating RGBA, then the parent validates result dimensions and exact byte length.
- Worker startup/import/HEVC decode has a 15-second deadline. It is terminated and awaited on success, failure, crash, malformed result or timeout. Synchronous WASM does not block the API event loop. The initial asynchronous native Sharp header inspection is outside this worker deadline, as are other formats' existing metadata checks; this is not a claim that all untrusted parsing is worker-isolated or that the entire request has a 15-second deadline. Host request/process limits remain necessary. No raw codec diagnostics reach API clients/logs.
- V8 old-generation heap is limited to 128 MiB in the worker, **not total process memory**: WASM/native/external arrays are not capped by this setting. RGBA alone can use 96 MB at the pixel limit, plus codec/native/variant and buffered batch memory. Enforce host memory/body/request-time limits and upstream rate/concurrency controls. This is not an OS sandbox or constant-memory guarantee.
- Existing per-WebP encode timeout remains 15 seconds; R2 request bounds/compensation are unchanged. A total ten-file batch deadline is not introduced. HTTP clients/proxies must accommodate sequential conversion within configured host limits.

Invalid input returns safe400 with supported-format guidance; byte/pixel oversize returns413 where identified by admission checks. Storage/cleanup errors retain503. A codec failure is not proof that the original photo is corrupt.

## Frontend behavior and release boundary

Create/edit property and blog image selectors explicitly list supported formats, including HEIC/HEIF extensions for platforms that report an empty or generic MIME. Unsupported browser preview does not prevent uploading: HEIC selection shows a filename/selected-photo placeholder and is converted on the server at Save. The original selected File is submitted, not a browser-generated conversion. Supported-format and size/pixel guidance remains advisory; backend validation is authoritative.

Deploy the compatible backend before the frontend under separately approved release authority. Removing this decoder on rollback prevents new HEIC inputs but does not break existing saved WebP URLs. No push, deployment, provider upload, production database write or real message is authorized by this local checkpoint.

## Local verification

`test/heic.test.js` uses tiny repository-generated red/blue HEVC fixtures, never client photos. It exercises real decoding, orientation/metadata/no-upscale, pixel/multipage/sequence/corruption rejection, independent decoder dimensions, crash/exit/bad-result and an accelerated stuck-worker timeout. `test/upload.test.js` exercises owner multipart with generic MIME and real conversion using explicit S3 method doubles; `test/r2-loopback.test.js` exercises real AWS SDK signed HTTP and all WebP bytes plus compensation against a local S3-wire fixture. These are not real R2 or Mongo persistence acceptance.

The client's supplied HEIC is a separate local acceptance input, not a versioned test asset or provider upload. See `docs/heic-uploads-evidence.json` for final executed results, source bindings and disclosed fixture limitations. Historical `r2-images-evidence.json` predates HEIC support and must not be treated as proof for this patch.
