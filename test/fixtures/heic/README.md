# Synthetic HEIC codec fixtures

These tiny fixtures contain only an80×40red/blue split rectangle generated for this repository. They contain no client photos, location or private metadata. They are test assets under the repository's MIT license. Runtime/tests do **not** require Python, Pillow or a system HEIF encoder; the encoded bytes are checked in.

Generation used Python Pillow + pillow-heif1.8.1 and `heif-enc`/libheif1.23.6:

- Create an RGB80×40red image and fill x40–79blue.
- `pillow_heif.from_pillow(image).save(...,quality=90,exif=None)` produces `single.heic`.
- Same call with `exif=Image.Exif()` containing274=6and271=`Synthetic fixture` produces `rotated.heic`. This fixture tests metadata stripping; EXIF is not the HEIF item's intrinsic rotation authority.
- Append a second identical `HeifImage` with `append_images=[pillow_heif.from_pillow(image)[0]]` to produce `multiple.heic` (two top-level images; rejected).
- Save the source as PNG and run `heif-enc --rotate-cw 90 -q 90 -o intrinsic-rotation.heic source.png`. The HEIF item transform produces40×80with red on top/blue below. Tests verify dimensions **and pixel placement**, guarding against missing/double rotation.
- `pixel-limit.heic` is a generated 5000 × 5000 solid red image saved by pillow-heif at quality20, testing rejection above24million pixels without allocating decoded RGBA.

Only these synthetic bytes are versioned. The user-supplied HEIC is used separately for local acceptance without being copied into source or sent to providers.
