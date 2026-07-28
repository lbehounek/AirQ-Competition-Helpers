/**
 * Shared, fully-typed test support for the photo-helper suite.
 *
 * WHY this module exists: every fixture below used to be hand-rolled per test
 * file behind an `as any` — most commonly `canvasState: {} as any`, which is
 * NOT a valid `ApiPhoto['canvasState']` at all. A fixture that lies about its
 * shape means the compiler can no longer tell us when a producer stops
 * satisfying the type the consumer reads, which is exactly the drift these
 * tests exist to catch. Everything here is honest: if `ApiPhoto` changes, the
 * factories break loudly and once, instead of silently in eight files.
 */

import type { StorageInterface, StorageHandles, DirectoryHandle } from '@airq/shared-storage';
import type { CompetitionService } from '../../services/competitionService';
import type { AddPhotosResult, ApiPhoto } from '../../types/api';

/** The editor's canvas state, as carried by every `ApiPhoto`. */
type CanvasState = ApiPhoto['canvasState'];

/**
 * A neutral, complete `canvasState` — the same defaults a freshly-imported
 * photo gets (identity transform, no adjustments, label bottom-left).
 *
 * Returns a FRESH object on every call: several tests mutate a photo's
 * canvasState in place (`photo.canvasState = { ...photo.canvasState, ... }`),
 * so a shared singleton would leak state between cases.
 */
export function makeCanvasState(overrides: Partial<CanvasState> = {}): CanvasState {
  return {
    position: { x: 0, y: 0 },
    scale: 1,
    brightness: 0,
    contrast: 1,
    sharpness: 0,
    whiteBalance: { temperature: 0, tint: 0, auto: false },
    labelPosition: 'bottom-left',
    ...overrides,
  };
}

/**
 * Narrow an `AddPhotosResult` to its `ok` arm, throwing if it isn't one.
 *
 * WHY not a cast: `expect(r.kind).toBe('ok')` proves the arm at runtime but
 * tells TypeScript nothing, so the `routedTo` / `count` reads that follow
 * would still be errors on the union. A cast would paper over the opposite
 * failure — an `err` result read as `ok` would surface as `undefined` field
 * assertions instead of a clear message. This throws with the actual value.
 */
export function asOkResult(result: AddPhotosResult | undefined): Extract<AddPhotosResult, { kind: 'ok' }> {
  if (!result || result.kind !== 'ok') {
    throw new Error(`Expected an ok AddPhotosResult, got: ${JSON.stringify(result)}`);
  }
  return result;
}

/** Mirror of {@link asOkResult} for the `err` arm (`reason` / `message`). */
export function asErrResult(result: AddPhotosResult | undefined): Extract<AddPhotosResult, { kind: 'err' }> {
  if (!result || result.kind !== 'err') {
    throw new Error(`Expected an err AddPhotosResult, got: ${JSON.stringify(result)}`);
  }
  return result;
}

/**
 * The three lazily-populated caches `CompetitionService.ensureInitialized()`
 * checks. Declared separately because they are `private` and therefore absent
 * from `CompetitionService`'s public type.
 */
type CompetitionServiceCaches = {
  storage: StorageInterface | null;
  handles: StorageHandles | null;
  competitionsDir: DirectoryHandle | null;
};

/**
 * Wipe the module-singleton service's cached storage handles so the next
 * `ensureInitialized()` re-grabs whatever `getStorage()` currently returns.
 * Tests that swap in a fresh in-memory storage double per case need this or
 * the second test keeps writing into the first test's storage.
 *
 * The fields are `private`, so this necessarily reaches past the declared
 * surface — but it models the private cache's real shape rather than reaching
 * for `any`, so the three writes are still checked against the actual nullable
 * field types, and the parameter stays `CompetitionService` so it cannot be
 * aimed at the wrong object. A public `reset()` on the service would remove
 * the need for the assertion entirely.
 */
export function resetCompetitionServiceCaches(service: CompetitionService): void {
  const caches = service as unknown as CompetitionServiceCaches;
  caches.storage = null;
  caches.handles = null;
  caches.competitionsDir = null;
}
