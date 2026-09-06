// Phase 1b of photo-map-culling: thumbnail synthesis.
// See docs/photo-map-culling/implementation-plan.md.
//
// The implementation moved to `@airq/shared-storage` (src/photoThumbs.ts) when
// photo-helper grew its own thumbnail tier for the candidate tray: neither app
// may import from the other, and shared-storage — which already owns the
// `thumbs/{id}.jpg` storage contract — is the only package both depend on.
//
// This module stays as the import path the photoImport pipeline (and its
// tests, which `vi.mock` this specifier) already use. Behaviour is identical:
// the shared copy reads `createImageBitmap` / `OffscreenCanvas` off the global
// object at call time, so stubbing them still works through the re-export.
export { generateThumb, fitWithin, type GenerateThumbOpts } from '@airq/shared-storage'
