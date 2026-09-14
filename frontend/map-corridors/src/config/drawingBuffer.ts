/**
 * WebGL context options shared by every map this app constructs.
 *
 * Keep the WebGL backing store readable after a frame is composited, for BOTH
 * renderers this one source has to serve.
 *
 * mapbox-gl (desktop) takes `preserveDrawingBuffer` as a top-level MapOption.
 * maplibre-gl v6 (web) does NOT — it moved every context attribute into
 * `canvasContextAttributes`, and silently DROPS the top-level flag, so the web
 * build was constructing its canvas without it while the code plainly asked for
 * it. That flag is exactly what makes `getCanvas()` readable for the PNG/PDF
 * export in mapCapture.
 *
 * Passing both keys is deliberate: each renderer ignores the other's, so no
 * build-time branching is needed. maplibre spreads its own defaults before the
 * supplied object (verified in maplibre-gl.mjs), so `antialias` and
 * `powerPreference` are preserved rather than clobbered.
 *
 * NOT MEASURED: whether the web export was visibly blank or garbled in
 * practice. A canvas read can still succeed if it happens before the buffer is
 * cleared. Setting the flag correctly is strictly safer either way.
 *
 * Lives in its own module for two reasons: the two call sites (the <Map>
 * component and mapCapture's off-screen map) must not drift apart, and a
 * plain exported object is testable — asserting on maplibre's own .d.ts
 * proves nothing about what WE pass.
 */
export const PRESERVE_DRAWING_BUFFER_OPTIONS = {
  /** What mapbox-gl reads (desktop build). */
  preserveDrawingBuffer: true,
  /** What maplibre-gl v6 reads (web build); mapbox-gl ignores it. */
  canvasContextAttributes: { preserveDrawingBuffer: true },
} as const
