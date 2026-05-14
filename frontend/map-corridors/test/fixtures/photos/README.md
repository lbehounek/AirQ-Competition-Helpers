# Photo test fixtures

Synthetic JPEG fixtures for the photo-map-culling feature
(see [docs/photo-map-culling/implementation-plan.md](../../../../../docs/photo-map-culling/implementation-plan.md)
Phase 0–1).

## Conventions

- **Anonymized GPS only.** Never commit photos with real-world coordinates
  of an organizer's home, workplace, or competition site. Phase 0's exit
  criteria explicitly forbids this.
- Base coordinate for the synthetic dataset: **(50.0, 14.0)** — open
  countryside south of Mladá Boleslav, no addresses. Offsets in tenths/
  hundredths of a degree are fine (e.g. `(50.01, 14.02)`).
- Image content should be a tiny solid-color JPEG (~1 × 1 to 10 × 10 px)
  to keep the repo small. Real photographic content is unnecessary —
  the EXIF block is what tests exercise.
- All fixtures live in this directory. Tests load them via relative
  paths from `frontend/map-corridors/src/__tests__/`.

## Planned fixtures (Phase 1 — `extractExif.test.ts`)

| Filename | Purpose |
|---|---|
| `with-gps.jpg` | Valid GPS at (50.0, 14.0) — happy path |
| `no-gps.jpg` | EXIF present but no GPS tags — must yield `gps === undefined` |
| `gps-zero.jpg` | GPS = (0, 0) — must be treated as "no GPS" (camera GPS-lock failed) |
| `orientation-6.jpg` | EXIF Orientation = 6 (rotated 90° CW) — exercises `createImageBitmap({ imageOrientation: 'from-image' })` |
| `corrupt.jpg` | Truncated/invalid bytes — `extractExif` must reject gracefully |
| `heic.heic` | Real HEIC — rejected at MIME-type gate ([ADR-006](../../../../../docs/photo-map-culling/decisions.md#adr-006--no-heic-support-in-v1)) |
| `mislabeled.jpg` | HEIC bytes with a `.jpg` extension — rejected by content sniff, not extension |

These are **not** generated yet. Phase 1 will create them as part of
writing the `extractExif`/`generateThumb` tests, using a small Node
generator script that writes valid EXIF segments into minimal JPEGs.
Generator approach to evaluate:

- `piexifjs` (write EXIF to existing JPEG)
- Manual JPEG byte construction (no deps, fully reproducible)
- Repurpose `exifr`'s own test fixtures (if license-compatible)

## What NOT to put here

- The sample `RIMG*.JPG` photos at repo root — they're real Czech GPS
  coordinates, used only for one-off manual verification (see
  `scripts/verify-exif.mjs`). They are intentionally untracked.
- Anything with PII or copyright concerns.
