/**
 * Candidate-tray thumbnail tier — all the I/O orchestration behind a tray
 * thumb, in one React-free, unit-testable place.
 *
 * WHY this exists: the tray used to mount a full `PhotoEditorApi` per
 * candidate, which meant one full-resolution decode retained in the image
 * cache, two 600 px canvases, a window `pointermove` + `keydown` listener and
 * a 3 s idle timer PER CANDIDATE. A 40-candidate session paid that 40 times.
 * This module replaces it with ~20 KB of JPEG per candidate.
 *
 * Resolution order for one candidate:
 *   1. in-memory cache (id-keyed, insertion-order LRU, ≤ THUMB_CACHE_MAX)
 *   2. `competitions/{compId}/photos/thumbs/{id}.jpg` via `StorageInterface`
 *      (map-corridors already writes `pm-` thumbs there at import, so
 *      map-originated candidates get one for free)
 *   3. generate 320x240 JPEG from the photo's in-memory `blob:` URL
 *      (2 generations in flight at a time), then persist best-effort.
 *
 * KEY INVARIANT — photo bytes are IMMUTABLE per photo id. Ids are minted per
 * imported File (`crypto.randomUUID()` in useCompetitionSystem, `pm-…` in
 * map-corridors' importPhotoFiles) and ADR-020 content-hash dedup means
 * re-importing the same file reuses the same id and the same bytes. So a thumb
 * is keyed by id alone, is never "refreshed", and only ever DELETED. In
 * particular `addExistingCandidate` swapping the ApiPhoto record for an id
 * already in the pool needs no invalidation — only the record changed, not the
 * bytes. Adjustments (canvasState) are deliberately not reflected: the thumb
 * shows the SOURCE photo; the modal shows the edit. See docs/CANDIDATE_PHOTOS.md.
 */
import { generateThumb, type GenerateThumbOpts, type StorageInterface, type DirectoryHandle } from '@airq/shared-storage';

/**
 * Tray thumb geometry. The image box is 144x100 CSS px, so 320 wide stays
 * crisp up to DPR ~2.2 and encodes to ~15-25 KB at q=0.75.
 * `decodeResizeWidth` is 2x `maxWidth`: it lets the bitmap factory downsize
 * during decode (bounding the transient) while keeping a 2x supersampling
 * margin for the final `drawImage`.
 */
export const CANDIDATE_THUMB_OPTS: GenerateThumbOpts = {
  maxWidth: 320,
  maxHeight: 240,
  quality: 0.75,
  decodeResizeWidth: 640,
};

/**
 * Count-based cache bound. 400 x ~20 KB ≈ 8 MB of JPEG bytes — the decoded
 * bitmaps on top of that belong to MOUNTED `<img>` elements only (~300 KB
 * each) and disappear when the tray is collapsed.
 */
export const THUMB_CACHE_MAX = 400;

/**
 * How many generations may run at once. Each one is a decode + draw + JPEG
 * encode; without a bound, a fresh 40-candidate session would try to decode 40
 * full-resolution photos simultaneously. Reads are deliberately NOT limited —
 * they are ≤ ~20 KB each (on Electron: two IPC calls plus one readFileSync per
 * candidate, ~80 calls for 40 candidates), so queueing them would only add
 * latency.
 */
export const THUMB_GENERATE_CONCURRENCY = 2;

/** Injectable I/O surface — everything the resolver touches outside itself. */
export interface CandidateThumbDeps {
  /** Storage backend, or null when `initStorage()` has not run (in-memory only). */
  storage: Pick<StorageInterface, 'getPhotoThumb' | 'savePhotoThumb'> | null;
  /**
   * `competitions/{compId}/photos`. `null` means "unavailable" — thumbs are
   * generated in memory and never persisted. Callers must NOT call in with a
   * dir belonging to a different competition; see `useCandidateThumbUrl`,
   * which waits (tri-state `undefined`) while AppApi is resolving one.
   */
  photosDir: DirectoryHandle | null;
  /** Override for tests. Default: `fetch(url)` → `blob()`. */
  fetchBlob?: (url: string) => Promise<Blob>;
  /** Override for tests. Default: `generateThumb(blob, CANDIDATE_THUMB_OPTS)`. */
  generate?: (blob: Blob) => Promise<Blob>;
}

interface CacheEntry {
  blob: Blob;
  /**
   * Whether this blob is on disk (or a persist for it is in flight). False for
   * an entry generated while no storage/dir was available — the next resolve
   * that DOES have both writes it out, so a competition whose dirs resolved
   * late still ends up with thumbs on disk.
   */
  persisted: boolean;
}

// Insertion order doubles as recency order: `touch` deletes and re-sets.
const cache = new Map<string, CacheEntry>();
// One shared promise per id, so a StrictMode double-mount (or two tray thumbs
// for the same id during a re-render) generates once.
const inFlight = new Map<string, Promise<Blob | null>>();
// Bumped by `invalidateCandidateThumb`. A resolve captures the epoch it started
// with and drops its result if the epoch moved — see the delete race below.
const epochs = new Map<string, number>();

// FIFO limiter state for generation only.
let active = 0;
const waiters: Array<() => void> = [];

// Generation failures are logged loudly ONCE per session and at debug level
// afterwards: the first one is the signal (a CSP regression would fail every
// single thumb), the other 39 are noise.
let generationFailureWarned = false;

/** Move `id` to the most-recent end of the insertion-order LRU. */
function touch(id: string): void {
  const entry = cache.get(id);
  if (!entry) return;
  cache.delete(id);
  cache.set(id, entry);
}

/** Insert/replace an entry and evict from the least-recent end. */
function commit(id: string, blob: Blob, persisted: boolean): CacheEntry {
  const entry: CacheEntry = { blob, persisted };
  cache.delete(id);
  cache.set(id, entry);
  while (cache.size > THUMB_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return entry;
}

/**
 * Best-effort write-through. Never awaited by the caller: a failed persist only
 * costs a regeneration next session, and blocking the tray paint on a disk
 * write would defeat the point. Clears the entry's `persisted` flag on failure
 * so a later resolve retries.
 */
function persist(
  storage: NonNullable<CandidateThumbDeps['storage']>,
  photosDir: DirectoryHandle,
  id: string,
  blob: Blob,
): void {
  void storage.savePhotoThumb(photosDir, id, blob).catch((err) => {
    console.warn('[candidateThumbs] thumb persist failed', id, err);
    const entry = cache.get(id);
    if (entry) entry.persisted = false;
  });
}

/**
 * Run `task` under the generation concurrency limit (FIFO).
 * Returns the task's result; rejections propagate after the slot is released.
 *
 * The slot is HANDED OVER, never released-then-reclaimed. A finishing task
 * that did `active--` and only then woke a waiter left `active` below the
 * limit for a full microtask — the woken waiter increments on its own next
 * tick — and any caller entering in that window (the very common shape: the
 * `await storage.getPhotoThumb` continuation of another candidate, already
 * queued at the same checkpoint) saw a free slot, entered, and ran alongside
 * the waiter. With a limit of 2 that meant three simultaneous
 * full-resolution decode + draw + JPEG encodes.
 */
async function runLimited<T>(task: () => Promise<T>): Promise<T> {
  if (active >= THUMB_GENERATE_CONCURRENCY) {
    // Do NOT increment here: the slot we are woken with is one the releasing
    // task never gave up on our behalf, so it is already counted.
    await new Promise<void>((resolve) => { waiters.push(resolve); });
  } else {
    active++;
  }
  try {
    return await task();
  } finally {
    const next = waiters.shift();
    // Only when nobody is queued does the count actually drop.
    if (next) next();
    else active--;
  }
}

/**
 * Synchronous cache lookup.
 *
 * Returns the cached thumb Blob, or undefined when the id has never been
 * resolved (or was evicted/invalidated). Refreshes recency on a hit.
 *
 * WHY it exists: a re-run of the loader effect (a new `blob:` URL after a
 * competition reload, or the photos dir finally resolving) must not push the
 * thumb back to a skeleton. The component peeks first and only shows 'loading'
 * when there is genuinely nothing to show.
 */
export function peekCandidateThumb(photoId: string): Blob | undefined {
  const entry = cache.get(photoId);
  if (!entry) return undefined;
  touch(photoId);
  return entry.blob;
}

/**
 * Resolve one candidate's thumbnail.
 *
 * Returns the thumb Blob, or `null` when none can be produced (placeholder /
 * missing source bytes, an invalidation mid-flight, or a generation failure) —
 * the caller then falls back to the full-resolution source image or a
 * "missing" state. Never rejects.
 *
 * Edge cases handled: concurrent callers for one id share a single promise;
 * a delete during the read/generate window drops the result instead of caching
 * or persisting it; an entry cached before storage was available is persisted
 * by the first later call that has both storage and a dir.
 */
export function resolveCandidateThumb(
  photo: { id: string; url: string },
  deps: CandidateThumbDeps,
): Promise<Blob | null> {
  const { id } = photo;
  const { storage, photosDir } = deps;

  // (1) Cache hit. Also the "persist what we generated earlier" opportunity:
  // the flag is set optimistically BEFORE the write so two concurrent hits
  // cannot both schedule one; `persist` clears it again if the write fails.
  const hit = cache.get(id);
  if (hit) {
    touch(id);
    if (!hit.persisted && storage && photosDir) {
      hit.persisted = true;
      persist(storage, photosDir, id, hit.blob);
    }
    return Promise.resolve(hit.blob);
  }

  // (2) Someone else is already resolving this id — share their promise.
  const pending = inFlight.get(id);
  if (pending) return pending;

  // (3) Do the work. `epoch` is the delete race guard: every await below is
  // followed by `stillCurrent()`, and a stale result is neither cached nor
  // persisted (otherwise `removeCandidate` could delete the photo file while a
  // queued generation is still behind the limiter, and we would write an
  // orphan thumb — and serve it — right after the delete).
  const epoch = epochs.get(id) ?? 0;
  const stillCurrent = () => (epochs.get(id) ?? 0) === epoch;

  const fetchBlob = deps.fetchBlob ?? ((url: string) => fetch(url).then((r) => r.blob()));
  const generate = deps.generate ?? ((blob: Blob) => generateThumb(blob, CANDIDATE_THUMB_OPTS));

  const work = (async (): Promise<Blob | null> => {
    // (3a) Stored thumb.
    if (storage && photosDir) {
      let stored: Blob | null = null;
      try {
        stored = await storage.getPhotoThumb(photosDir, id);
      } catch (err) {
        // ANY read error is treated as a miss. On OPFS a miss resolves to
        // null, but an Electron main process older than the `NotFound:`
        // rejection surfaced misses as a generic Error — and a genuinely
        // broken read is still best served by regenerating a correct thumb
        // rather than showing nothing.
        console.debug('[candidateThumbs] thumb read failed, regenerating', id, err);
      }
      if (!stillCurrent()) return null;
      if (stored) {
        commit(id, stored, true);
        return stored;
      }
    }

    // (3b) Nothing to generate from. `url: ''` is a turning-point placeholder
    // or a photo whose file is gone; a non-blob URL is not ours to fetch.
    if (!photo.url.startsWith('blob:')) return null;

    // (3c) Generate. `fetch(blob:)` reads the bytes already in memory — no
    // OPFS round-trip and, on Electron, no base64 IPC transfer of a 3-8 MB
    // file. It does depend on the CSP allowing `connect-src blob:` (the
    // desktop shell does; the web build sets no CSP), which is exactly what
    // the warn-once below makes visible: a CSP regression would otherwise
    // degrade silently to full-resolution <img> fallbacks everywhere.
    let blob: Blob;
    try {
      blob = await runLimited(async () => generate(await fetchBlob(photo.url)));
    } catch (err) {
      if (!generationFailureWarned) {
        generationFailureWarned = true;
        console.warn(
          '[candidateThumbs] thumb generation failed (further failures logged at debug level)',
          id,
          err,
        );
      } else {
        console.debug('[candidateThumbs] thumb generation failed', id, err);
      }
      return null;
    }

    // (3d) Deleted while we were generating — drop it on the floor.
    if (!stillCurrent()) return null;

    // (3e) Cache, then persist best-effort (see the optimistic flag above).
    const entry = commit(id, blob, false);
    if (storage && photosDir) {
      entry.persisted = true;
      persist(storage, photosDir, id, blob);
    }
    return blob;
  })();

  const tracked = work.finally(() => { inFlight.delete(id); });
  inFlight.set(id, tracked);
  return tracked;
}

/**
 * Drop everything we know about a photo's thumb.
 *
 * Returns nothing. Delete-only by design: because photo bytes are immutable
 * per id (see the module invariant), there is no "refresh" case — the only
 * reason a thumb stops being valid is that the photo itself is gone.
 *
 * Bumping the epoch is the important half: it makes any in-flight read or
 * generation for this id discard its result, so `removeCandidate` can revoke
 * the object URL and delete the file without a queued generation resurrecting
 * a cache entry (or writing an orphan file) behind it.
 */
export function invalidateCandidateThumb(photoId: string): void {
  cache.delete(photoId);
  inFlight.delete(photoId);
  epochs.set(photoId, (epochs.get(photoId) ?? 0) + 1);
}

/**
 * Reset all module state. Returns nothing. Test-only — module-level caches
 * would otherwise leak between test cases in the same file.
 */
export function resetCandidateThumbsForTests(): void {
  cache.clear();
  inFlight.clear();
  epochs.clear();
  active = 0;
  waiters.length = 0;
  generationFailureWarned = false;
}
