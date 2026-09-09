/**
 * Build-time-gated console tracing for the hot render/decode paths.
 *
 * WHY a gate instead of deleting the calls: the emoji traces in imageCache,
 * highQualityResize and PhotoEditorApi are the only visibility we have into
 * what the renderer is doing on the low-end competition laptops, so they stay
 * available — they just must not run on every slider tick in a normal session
 * (`getImageByUrl`/`getCached` log once per photo per pass; with ~20 mounted
 * canvases and DevTools open the string formatting alone is measurable).
 *
 * Opt-in via `VITE_DEBUG_RENDER=true` rather than `import.meta.env.DEV` so a
 * plain `pnpm dev` session stays quiet unless the developer asks for the noise.
 *
 * The read below is deliberately NOT optional-chained. Vite's define step
 * rewrites the exact text `import.meta.env.VITE_DEBUG_RENDER`; written as
 * `import.meta.env?.VITE_...` it does not match, and the gate degrades to a
 * runtime property lookup on the replacement object — still `false` in
 * production, but no longer a constant the minifier can fold. (Both Vite and
 * vitest guarantee `import.meta.env` exists in a module they processed, so the
 * `?.` bought nothing here; `utils/imageCache.ts` keeps its own for a runner
 * that does not process that file.)
 *
 * What that buys, precisely: `DEBUG_RENDER` folds to the literal `false`, so
 * the `console.log` branch below disappears from the production bundle. It does
 * NOT remove the ARGUMENTS at the call sites — a `debugLog(`…${w}x${h}…`)` still
 * builds its template literal before calling. Keep those cheap, or guard the
 * call with `if (DEBUG_RENDER)` where the formatting itself is hot.
 */
export const DEBUG_RENDER: boolean = import.meta.env.VITE_DEBUG_RENDER === 'true';

/**
 * Forward to `console.log` only when render debugging is enabled.
 * Returns nothing; never throws. Note the template literals at the call sites
 * are still built by the caller — keep them cheap.
 */
export function debugLog(...args: unknown[]): void {
  if (DEBUG_RENDER) console.log(...args);
}
