// Lazy facade for the PDF export. The real generator lives in
// `./pdfGeneratorImpl` and is reached ONLY through the `import()` below — one
// call site → one Rollup async chunk (`pdfGeneratorImpl-*.js`, ≈1.6 MB with
// @react-pdf/pdfkit/fontkit) fetched the first time the user exports, instead
// of ~1.6 MB of parse+compile on every app launch.
//
// The facade deliberately keeps the OLD module path: every existing and future
// importer (`AppApi.tsx`) writes `./utils/pdfGenerator` and gets the lazy path
// automatically, so the split cannot be regressed by someone re-adding a
// static import. Everything below is `import type` (erased under
// `verbatimModuleSyntax`), so nothing here pulls the heavy tree into the eager
// module graph — the build guard in `frontend/vite.chunks.ts` enforces that.

import type {
  generatePDF as GeneratePdfImpl,
  GeneratePdfOptions,
  PdfProgress,
} from './pdfGeneratorImpl';

// Re-exported so consumers keep importing their types from this module (AppApi
// does: `import { generatePDF, type PdfProgress } from './utils/pdfGenerator'`).
export type { GeneratePdfOptions, PdfProgress };

/** The implementation's full positional parameter list, kept in sync by inference. */
type PdfArgs = Parameters<typeof GeneratePdfImpl>;

/**
 * Load the heavy implementation module, translating a chunk-fetch failure into
 * a tagged, diagnosable error. Returns the impl's `generatePDF` function.
 *
 * Edge case (web build only): the deploy scripts rsync `--delete`, so a tab
 * left open across a release can no longer fetch the OLD hashed chunk. That
 * surfaces here as a rejected `import()`; we log a hint and rethrow a tagged
 * error so a caller can tell "module unreachable" from "render failed".
 * (Desktop serves local files under `app://` — this cannot happen there.)
 */
async function loadImpl(): Promise<typeof GeneratePdfImpl> {
  try {
    return (await import('./pdfGeneratorImpl')).generatePDF;
  } catch (cause) {
    console.error(
      '[pdf] failed to load the export module — a new version was probably deployed; reload the page',
      cause,
    );
    throw Object.assign(new Error('PDF export module failed to load'), {
      chunkLoadFailed: true as const,
      cause,
    });
  }
}

/**
 * Generate the answer-sheet PDF. Same positional signature as the
 * implementation (nine positional args + an optional `options` object) and the
 * same return shape: a promise resolving to `void`.
 *
 * Rejects with EXACTLY what the implementation rejects with — including the
 * `renderFailures` array that `AppApi.handleGeneratePDF` inspects in its catch
 * — plus the `chunkLoadFailed`-tagged error from {@link loadImpl} when the
 * async chunk itself cannot be fetched.
 *
 * Note on the impl's in-flight coalescing: the module-level guard lives in the
 * implementation module, which is evaluated once and cached by the ESM loader,
 * so two concurrent calls through this facade still coalesce onto one export.
 */
export async function generatePDF(...args: PdfArgs): Promise<void> {
  const impl = await loadImpl();
  return impl(...args);
}
