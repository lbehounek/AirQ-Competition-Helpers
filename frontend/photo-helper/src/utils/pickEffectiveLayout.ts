import type { LayoutMode } from '../contexts/LayoutModeContext';

/**
 * Resolve the layout to use for PDF generation.
 *
 * `LayoutModeSelector` updates the React context (`useLayoutMode`)
 * synchronously but the OPFS persist (`updateLayoutMode`) is async.
 * Clicking "Generate PDF" within the write window would otherwise read
 * the stale `session.layoutMode` and produce a PDF in the previous
 * layout — exactly matching the 2026-04-26 user complaint
 * "PDF layout 3x3/5x2 sometimes works, sometimes doesn't".
 *
 * Precedence (top wins):
 *   1. context layout — the truth the user just saw in the toggle
 *   2. session layout — cold-start fallback when the context is still
 *      hydrating from a freshly-loaded session
 *   3. 'landscape' — hardcoded floor for legacy sessions whose
 *      `session.layoutMode` was never persisted (`undefined`)
 *
 * Pure helper extracted from `AppApi.tsx:handleGeneratePDF` so the
 * precedence contract can be unit-tested directly. A future refactor
 * that flips the order would silently re-introduce the race the PR
 * fixed; the test pins the order.
 */
export function pickEffectiveLayout(
  contextLayout: LayoutMode | undefined | null,
  sessionLayout: LayoutMode | undefined | null,
): LayoutMode {
  return contextLayout || sessionLayout || 'landscape';
}
