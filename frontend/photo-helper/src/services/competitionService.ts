/**
 * Competition versioning service for storage
 * Manages multiple competitions with photo isolation
 * Works with both OPFS (web) and native filesystem (Electron)
 */

import type {
  Competition,
  CompetitionMetadata,
  CompetitionsIndex,
  CleanupCandidate,
  StorageStats
} from '../types/competition';
import type { ApiPhoto, ApiPhotoSession, ApiPhotoSet, CandidatePool } from '../types/api';
import {
  // Only `initStorage` — the service caches the returned instance on
  // `this.storage` and reads it from there; it never calls `getStorage()`.
  initStorage,
  createSerialQueue,
  type SerialQueue,
  type StorageInterface,
  type DirectoryHandle,
  type StorageHandles,
} from '@airq/shared-storage';

const COMPETITIONS_INDEX_FILE = 'competitions-index.json';
const MAX_COMPETITIONS = 10;
const MAX_AGE_DAYS = 30;

/**
 * How stale `competitions-index.json`'s `lastModified` may get before a save
 * rewrites it anyway.
 *
 * WHY: the index carries only `name` / `lastModified` / `photoCount`. A canvas
 * edit (brightness, zoom, circle radius — the entire slider hot path) changes
 * NONE of them, so the read-modify-write of a second whole file on every save
 * was pure overhead. Name and photoCount changes still write immediately; only
 * `lastModified` is allowed to lag, by at most this long, and
 * `flushPendingWrites()` catches it up at every navigation choke point.
 */
const INDEX_REFRESH_MS = 10_000;

/**
 * The `{ set1, set2 }` pair shape. `ApiPhotoSession` spells it out inline
 * three times (`sets`, `setsTrack`, `setsTurning`); naming it here lets the
 * URL-stripping / photo-collecting / blob-loading helpers below be written
 * once and still be honest about what they take.
 */
type ModeSets = { set1: ApiPhotoSet; set2: ApiPhotoSet };

/**
 * Narrow `unknown` to an indexable object, or `undefined`.
 *
 * Used only for `session.json` files read back off disk during index rebuild
 * (`rebuildIndexFromDirs`). Those are genuinely untrusted: they may predate
 * any current field, or be half-written by a save that was interrupted by a
 * tab close. Arrays pass the `typeof` check too, which is harmless — every
 * property we go on to read is simply absent on an array.
 */
const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;

/** Narrow `unknown` to a string, or `undefined` if it is anything else. */
const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/**
 * Photo count of one persisted set, tolerating a missing set, a missing
 * `photos` key, or a `photos` value that is not an array.
 */
const countPersistedPhotos = (set: unknown): number => {
  const photos = asRecord(set)?.photos;
  return Array.isArray(photos) ? photos.length : 0;
};

/**
 * Persistence for competitions, over OPFS (web) or the native filesystem
 * (Electron) — both behind `StorageInterface`.
 *
 * WRITE-PATH INVARIANTS (see docs/PERSISTENCE.md). Every writer of
 * `session.json` or `competitions-index.json` in this renderer goes through
 * ONE FIFO `writeQueue`, because `StorageInterface.writeJSON` promises no
 * ordering across overlapping calls and both files are whole-file snapshots.
 *
 *  1. PUBLIC mutators enqueue exactly once.
 *  2. PRIVATE helpers (`getCompetitionsIndex`, `saveCompetitionsIndex`,
 *     `writeSessionNow`, `writeIndexEntryNow`, `refreshIndexEntryIfNeeded`)
 *     NEVER enqueue. Re-entering the queue from inside a queued task
 *     deadlocks silently — the inner task waits on a tail that only completes
 *     when the outer one returns.
 *  3. Publish-before-enqueue: `updateCompetition` records the owed payload
 *     synchronously, before its first `await`, so a caller firing during
 *     `pagehide` has its snapshot registered even if the write never lands.
 */
export class CompetitionService {
  private storage: StorageInterface | null = null;
  private handles: StorageHandles | null = null;
  private competitionsDir: DirectoryHandle | null = null;

  /**
   * The one FIFO shared by every writer of `session.json` and
   * `competitions-index.json`. Serializes; coalescing is this class's own
   * policy, implemented with the three maps below.
   */
  private readonly writeQueue: SerialQueue = createSerialQueue();

  /**
   * Newest payload still owed per competition id, published BEFORE the task is
   * enqueued. A burst of N saves therefore collapses to ONE write of the last
   * snapshot: the first task drains the entry, the rest find it gone and
   * no-op. `updatePhotos` is OR-accumulated so a coalesced write never skips
   * photo bytes an earlier call in the burst asked for.
   */
  private pendingSessionWrites = new Map<string, { competition: Competition; updatePhotos: boolean }>();

  /**
   * What THIS service last wrote into the index for an id. Drives the
   * "does the index actually need rewriting?" decision without reading the
   * file back on every save.
   */
  private indexTouch = new Map<string, { name: string; photoCount: number; writtenAt: number }>();

  /** Ids whose index `lastModified` was skipped and is still owed. */
  private indexDirty = new Set<string>();

  async initialize(): Promise<void> {
    this.storage = await initStorage();
    this.handles = await this.storage.init();
    this.competitionsDir = await this.storage.getDirectoryHandle(
      this.handles.root,
      'competitions',
      { create: true }
    );
  }

  async ensureInitialized(): Promise<void> {
    if (!this.storage || !this.handles || !this.competitionsDir) {
      await this.initialize();
    }
  }

  // Competition Index Management
  async getCompetitionsIndex(): Promise<CompetitionsIndex> {
    await this.ensureInitialized();
    const existing = await this.storage!.readJSON<CompetitionsIndex>(
      this.handles!.root,
      COMPETITIONS_INDEX_FILE
    );

    if (existing) {
      // Validate: if index says empty but competition dirs exist, rebuild
      if (existing.competitions.length === 0) {
        const rebuilt = await this.rebuildIndexFromDirs();
        if (rebuilt && rebuilt.competitions.length > 0) {
          console.warn('Rebuilt competitions index from directories:', rebuilt.competitions.length, 'competitions');
          await this.saveCompetitionsIndex(rebuilt);
          return rebuilt;
        }
      }
      return existing;
    }

    // No index file — try to rebuild from existing directories
    const rebuilt = await this.rebuildIndexFromDirs();
    if (rebuilt && rebuilt.competitions.length > 0) {
      console.log('Created competitions index from existing directories:', rebuilt.competitions.length, 'competitions');
      await this.saveCompetitionsIndex(rebuilt);
      return rebuilt;
    }

    // Create empty index
    const newIndex: CompetitionsIndex = {
      competitions: [],
      activeCompetitionId: null,
      version: 1
    };

    await this.saveCompetitionsIndex(newIndex);
    return newIndex;
  }

  /**
   * Attempt to rebuild the index by scanning the competitions directory.
   * This recovers from cases where the index was lost or corrupted.
   */
  private async rebuildIndexFromDirs(): Promise<CompetitionsIndex | null> {
    try {
      await this.ensureInitialized();
      const entries = await this.storage!.listDirectory(this.competitionsDir!);
      const compDirs = entries.filter(e => e.isDirectory && e.name.startsWith('comp-'));

      if (compDirs.length === 0) return null;

      const competitions: CompetitionMetadata[] = [];
      for (const dir of compDirs) {
        try {
          const compDir = await this.storage!.getDirectoryHandle(
            this.competitionsDir!, dir.name, { create: false }
          );
          // Read as `unknown` rather than asserting `ApiPhotoSession`: this is
          // the recovery path for a lost/corrupt index, so the very files it
          // scans are the ones most likely to be malformed. Each field is
          // narrowed individually so a bad file degrades to the directory name
          // and "now" instead of writing a non-string into CompetitionMetadata.
          const raw = await this.storage!.readJSON<unknown>(compDir, 'session.json');
          const session = asRecord(raw);
          const sets = asRecord(session?.sets);
          const name = asString(session?.competition_name) || dir.name;
          const createdAt = asString(session?.createdAt) || new Date().toISOString();
          const lastModified = asString(session?.updatedAt) || createdAt;
          const photoCount = countPersistedPhotos(sets?.set1) + countPersistedPhotos(sets?.set2);

          competitions.push({
            id: dir.name,
            name,
            createdAt,
            lastModified,
            photoCount,
            isActive: false
          });
        } catch {
          // Skip directories that can't be read
        }
      }

      if (competitions.length === 0) return null;

      // Mark the most recently modified as active
      competitions.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());
      competitions[0].isActive = true;

      return {
        competitions,
        activeCompetitionId: competitions[0].id,
        version: 1
      };
    } catch {
      return null;
    }
  }

  async saveCompetitionsIndex(index: CompetitionsIndex): Promise<void> {
    await this.ensureInitialized();
    await this.storage!.writeJSON(this.handles!.root, COMPETITIONS_INDEX_FILE, index);
  }

  // Competition CRUD Operations
  async createCompetition(name: string, session: ApiPhotoSession): Promise<Competition> {
    await this.ensureInitialized();

    const id = `comp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const competition: Competition = {
      id,
      name,
      createdAt: now,
      lastModified: now,
      photoCount: this.calculatePhotoCount(session),
      session: this.sanitizeSessionForStorage(session)
    };

    // Create competition directory and save session
    const competitionDir = await this.storage!.getDirectoryHandle(
      this.competitionsDir!,
      id,
      { create: true }
    );
    const photosDir = await this.storage!.getDirectoryHandle(
      competitionDir,
      'photos',
      { create: true }
    );

    await this.storage!.writeJSON(competitionDir, 'session.json', competition.session);

    // Save photos to competition directory
    await this.saveSessionPhotos(session, photosDir);

    // Update index — through the write queue, so a save still in flight for
    // another competition cannot read-modify-write over our new entry.
    await this.writeQueue(async () => {
      const index = await this.getCompetitionsIndex();
      const metadata: CompetitionMetadata = {
        id: competition.id,
        name: competition.name,
        createdAt: competition.createdAt,
        lastModified: competition.lastModified,
        photoCount: competition.photoCount,
        isActive: true // New competition becomes active
      };

      // Set all others to inactive
      index.competitions.forEach(comp => comp.isActive = false);
      index.competitions.push(metadata);
      index.activeCompetitionId = id;

      await this.saveCompetitionsIndex(index);
    });
    return competition;
  }

  async getCompetition(id: string): Promise<Competition | null> {
    await this.ensureInitialized();

    try {
      const competitionDir = await this.storage!.getDirectoryHandle(
        this.competitionsDir!,
        id,
        { create: false }
      );
      const session = await this.storage!.readJSON<ApiPhotoSession>(competitionDir, 'session.json');

      if (!session) {
        return null;
      }

      const index = await this.getCompetitionsIndex();
      const metadata = index.competitions.find(c => c.id === id);

      if (!metadata) {
        return null;
      }

      // Load photos with blob URLs
      const photosDir = await this.storage!.getDirectoryHandle(
        competitionDir,
        'photos',
        { create: false }
      );
      const sessionWithUrls = await this.loadSessionPhotos(session, photosDir);

      return {
        id,
        name: metadata.name,
        createdAt: metadata.createdAt,
        lastModified: metadata.lastModified,
        photoCount: metadata.photoCount,
        session: sessionWithUrls
      };
    } catch {
      return null;
    }
  }

  /**
   * Persist a competition. Signature unchanged; the BEHAVIOUR is now
   * coalescing and serialized (see the class-head invariants).
   *
   * A burst of saves for the same id — a slider drag, a pan, an apply-to-all
   * fan-out — collapses into ONE `session.json` write carrying the newest
   * snapshot. Every call still resolves only once the write that superseded
   * it has settled, so `await updateCompetition(...)` keeps meaning "it is on
   * disk" and existing callers need no change.
   *
   * Returns nothing; rejects with the underlying storage error when the write
   * that ran for this call failed. A call whose payload was superseded before
   * its task ran resolves without writing anything.
   */
  async updateCompetition(competition: Competition, options?: { updatePhotos?: boolean }): Promise<void> {
    const id = competition.id;
    const prev = this.pendingSessionWrites.get(id);
    // Everything up to the enqueue is synchronous on purpose: a `pagehide`
    // caller must have its payload OWED before the first await, so a later
    // `flushPendingWrites()` can still find and write it.
    const mine = {
      competition,
      // OR-accumulate: if any coalesced call in this burst wanted photo bytes
      // written, the single surviving write must write them.
      updatePhotos: Boolean(options?.updatePhotos) || Boolean(prev?.updatePhotos),
    };
    this.pendingSessionWrites.set(id, mine);

    await this.writeQueue(async () => {
      await this.ensureInitialized();
      const pending = this.pendingSessionWrites.get(id);
      // Nothing owed: an earlier task in this burst already wrote the newest
      // snapshot on our behalf (or the competition was deleted meanwhile).
      if (!pending) return;

      await this.writeSessionNow(pending.competition, pending.updatePhotos);
      // Clear only on success AND identity — a newer publish that landed while
      // we were writing stays owed and is picked up by the next task.
      if (this.pendingSessionWrites.get(id) === pending) {
        this.pendingSessionWrites.delete(id);
      }
      await this.refreshIndexEntryIfNeeded(pending.competition);
    });
  }

  /**
   * Forget the payload still owed for `competition`, but ONLY while it is
   * still exactly that snapshot.
   *
   * Returns true when a payload was dropped, false when nothing was owed or a
   * newer publish had already superseded it.
   *
   * WHY: `updateCompetition` deliberately keeps a FAILED payload owed so a
   * later `flushPendingWrites` can retry it. That is right for a caller that
   * kept the edit — but the editor hook ROLLS BACK on a failed persist and
   * tells the user the edit was not saved. Without this escape hatch the next
   * flush (tab hidden, pagehide, competition switch, goHome) would write the
   * rolled-back edit to disk anyway, and it would reappear after a reload.
   *
   * The identity check is the whole safety of it: under coalescing a newer
   * call may already have replaced the owed payload, and that newer state must
   * survive — the roll-back only speaks for the snapshot it published itself.
   */
  discardPendingWrite(competition: Competition): boolean {
    const pending = this.pendingSessionWrites.get(competition.id);
    if (!pending || pending.competition !== competition) return false;
    this.pendingSessionWrites.delete(competition.id);
    return true;
  }

  /**
   * Write one competition's `session.json` (and, when asked, its photo
   * bytes). Never enqueues — it is only ever called from inside a queued task.
   */
  private async writeSessionNow(competition: Competition, updatePhotos: boolean): Promise<void> {
    const competitionDir = await this.storage!.getDirectoryHandle(
      this.competitionsDir!,
      competition.id,
      { create: false }
    );
    const photosDir = await this.storage!.getDirectoryHandle(
      competitionDir,
      'photos',
      { create: true }
    );

    // Update session data
    const sanitizedSession = this.sanitizeSessionForStorage(competition.session);
    await this.storage!.writeJSON(competitionDir, 'session.json', sanitizedSession);

    // Only update photos if explicitly requested (e.g., when photos actually changed)
    if (updatePhotos) {
      await this.saveSessionPhotos(competition.session, photosDir);
    }
  }

  /**
   * Rewrite this competition's index entry — but only when it would actually
   * say something new, or when its `lastModified` has gone stale.
   *
   * Returns nothing. Marks the id dirty FIRST so that a skipped (or failed)
   * write leaves `flushPendingWrites()` a note to catch up later; the mark is
   * cleared again only once the entry really has been written. Never enqueues.
   */
  private async refreshIndexEntryIfNeeded(competition: Competition): Promise<void> {
    const id = competition.id;
    const photoCount = this.calculatePhotoCount(competition.session);
    const now = Date.now();
    const touch = this.indexTouch.get(id);

    this.indexDirty.add(id);

    const needsWrite = !touch
      || touch.name !== competition.name
      || touch.photoCount !== photoCount
      || now - touch.writtenAt >= INDEX_REFRESH_MS;
    if (!needsWrite) return;

    await this.writeIndexEntryNow(id, {
      name: competition.name,
      photoCount,
      lastModified: new Date(now).toISOString(),
    });
    this.indexTouch.set(id, { name: competition.name, photoCount, writtenAt: now });
    this.indexDirty.delete(id);
  }

  /**
   * Patch one entry of `competitions-index.json` in place (read → splice →
   * write). A missing entry is a no-op: the competition was deleted, or the
   * index was rebuilt without it. Never enqueues.
   */
  private async writeIndexEntryNow(
    id: string,
    patch: Pick<CompetitionMetadata, 'name' | 'photoCount' | 'lastModified'>
  ): Promise<void> {
    const index = await this.getCompetitionsIndex();
    const metadataIndex = index.competitions.findIndex(c => c.id === id);
    if (metadataIndex < 0) return;

    index.competitions[metadataIndex] = { ...index.competitions[metadataIndex], ...patch };
    await this.saveCompetitionsIndex(index);
  }

  /**
   * Drain everything still owed: first retry session payloads left behind by
   * FAILED writes, then apply the index `lastModified` patches that the
   * throttle skipped.
   *
   * Best-effort but honest — per-entry isolation means one competition's
   * failure never blocks the others, and the FIRST error is rethrown once the
   * whole pass is done. A `NotFoundError` (the competition directory is gone)
   * drops that payload for good rather than retrying it forever.
   *
   * Returns nothing. Fired at every navigation choke point: pagehide,
   * visibility-hidden, desktop goHome / switch-app, and before
   * create / switch / delete / mode-switch.
   */
  async flushPendingWrites(): Promise<void> {
    await this.writeQueue(async () => {
      await this.ensureInitialized();
      let firstError: unknown;
      // What the retry loop below actually landed on disk, per id. The payload
      // is dropped from `pendingSessionWrites` the moment it is written, so
      // without this note the index loop would fall back to `indexTouch` — the
      // values of the last SUCCESSFUL index write, which PREDATE the payload
      // just flushed. A rename or a photo added by the retried write would then
      // be patched away again (and, with no `indexTouch` at all, the id would be
      // dropped from `indexDirty` and never refreshed).
      const written = new Map<string, { name: string; photoCount: number }>();

      // Snapshot the maps: the loops below await, and a concurrent publish may
      // add entries we must not visit twice in this pass.
      for (const [id, pending] of [...this.pendingSessionWrites]) {
        try {
          await this.writeSessionNow(pending.competition, pending.updatePhotos);
          if (this.pendingSessionWrites.get(id) === pending) {
            this.pendingSessionWrites.delete(id);
          }
          written.set(id, {
            name: pending.competition.name,
            photoCount: this.calculatePhotoCount(pending.competition.session),
          });
          // The session file moved; its index entry is now behind.
          this.indexDirty.add(id);
        } catch (err) {
          if ((err as { name?: string } | null)?.name === 'NotFoundError') {
            // The directory is gone — this payload can never be written.
            this.pendingSessionWrites.delete(id);
            this.indexDirty.delete(id);
            this.indexTouch.delete(id);
          }
          firstError ??= err;
        }
      }

      for (const id of [...this.indexDirty]) {
        try {
          const touch = this.indexTouch.get(id);
          const pending = this.pendingSessionWrites.get(id);
          // Newest truth first: a payload still owed (one the retry loop failed
          // on, or a publish that landed mid-pass), then what the retry loop
          // just wrote, and only then the last index write. With none of the
          // three there is nothing to say.
          const fresh = pending
            ? {
                name: pending.competition.name,
                photoCount: this.calculatePhotoCount(pending.competition.session),
              }
            : written.get(id);
          const name = fresh?.name ?? touch?.name;
          const photoCount = fresh?.photoCount ?? touch?.photoCount;
          if (name === undefined || photoCount === undefined) {
            this.indexDirty.delete(id);
            continue;
          }
          const now = Date.now();
          await this.writeIndexEntryNow(id, {
            name,
            photoCount,
            lastModified: new Date(now).toISOString(),
          });
          this.indexTouch.set(id, { name, photoCount, writtenAt: now });
          this.indexDirty.delete(id);
        } catch (err) {
          firstError ??= err;
        }
      }

      if (firstError) throw firstError;
    });
  }

  /**
   * Deletion of specific photo files from a competition's `photos/`
   * directory. Used to reclaim OPFS storage for culled candidate photos —
   * `saveSessionPhotos` deliberately never prunes (to protect non-active mode
   * buckets), so per-photo deletes must be explicit (PR #62 review C3).
   *
   * Returns `{ failed }` listing ids whose individual delete operation
   * threw. Callers that surface partial failures to the user (e.g., the
   * cleanup dialog, see PR #62 review CRIT-3) inspect this list; callers
   * doing background per-photo cleanup ignore it. A missing competition
   * directory is treated as success (the files are gone by definition).
   */
  async deletePhotosByIds(competitionId: string, photoIds: string[]): Promise<{ failed: string[] }> {
    if (photoIds.length === 0) return { failed: [] };
    await this.ensureInitialized();
    let photosDir: DirectoryHandle;
    try {
      const competitionDir = await this.storage!.getDirectoryHandle(
        this.competitionsDir!,
        competitionId,
        { create: false }
      );
      photosDir = await this.storage!.getDirectoryHandle(
        competitionDir,
        'photos',
        { create: false }
      );
    } catch (err) {
      // Competition (or its photos/) doesn't exist — treat as already-cleaned.
      // ONLY `NotFoundError` qualifies; anything else (transient OPFS error,
      // lock contention from a concurrent tab, quota, permission) must be
      // reported back to the caller as a partial failure or orphan files
      // accumulate while the cleanup dialog claims success (PR #62 review I3).
      const name = (err as { name?: string } | null)?.name;
      if (name === 'NotFoundError') {
        return { failed: [] };
      }
      console.error(`deletePhotosByIds: cannot open photos dir for ${competitionId}:`, err);
      return { failed: photoIds };
    }
    const failed: string[] = [];
    for (const id of photoIds) {
      try {
        await this.storage!.deletePhotoFile(photosDir, id);
      } catch (err) {
        console.warn(`deletePhotosByIds: failed to delete ${id}:`, err);
        failed.push(id);
      }
      // Tray thumbnails live at `photos/thumbs/{id}.jpg` (written by the
      // candidate thumbnail tier and by map-corridors' import). Best-effort and
      // deliberately NOT counted in `failed`: the cleanup dialog reports how
      // much PHOTO storage was reclaimed, and a stranded ~20 KB thumb must not
      // make a successful photo delete look like a failure. `deletePhotoThumb`
      // is already idempotent for a missing thumb / missing `thumbs/` dir.
      try {
        await this.storage!.deletePhotoThumb(photosDir, id);
      } catch (err) {
        console.warn(`deletePhotosByIds: thumb delete failed for ${id}:`, err);
      }
    }
    return { failed };
  }

  async deleteCompetition(id: string): Promise<void> {
    await this.writeQueue(async () => {
      await this.ensureInitialized();

      try {
        // Delete competition directory by clearing it and then removing
        const competitionDir = await this.storage!.getDirectoryHandle(
          this.competitionsDir!,
          id,
          { create: false }
        );

        // Clear the directory contents first
        await this.storage!.clearDirectory(competitionDir);

        // Tombstone, INSIDE the queued task: FIFO guarantees every earlier task
        // for this id has already finished, and any task enqueued after us finds
        // nothing owed and no-ops. Dropping these outside the task would let a
        // queued stale snapshot re-create session.json in a deleted directory.
        this.pendingSessionWrites.delete(id);
        this.indexDirty.delete(id);
        this.indexTouch.delete(id);

        // Note: For OPFS, we need to use a different approach
        // The storage abstraction handles directory deletion
        // For now, we'll use the parent to remove the entry
        try {
          // Try to get competitions directory entries and remove
          const entries = await this.storage!.listDirectory(this.competitionsDir!);
          if (entries.find(e => e.name === id && e.isDirectory)) {
            // Use a workaround: re-get the directory and clear it
            // The directory should be empty now, attempting removal
            // For OPFS this requires removeEntry on parent
            // For Electron this is handled by the IPC

            // This is a limitation of the abstraction - we need direct parent access
            // For now, just ensure it's empty which effectively "deletes" it
          }
        } catch {
          // Ignore errors during cleanup
        }

        // Update index
        const index = await this.getCompetitionsIndex();
        index.competitions = index.competitions.filter(c => c.id !== id);

        // If this was the active competition, set another as active
        if (index.activeCompetitionId === id) {
          index.activeCompetitionId = index.competitions.length > 0 ? index.competitions[0].id : null;
          if (index.competitions.length > 0) {
            index.competitions[0].isActive = true;
          }
        }

        await this.saveCompetitionsIndex(index);
      } catch (error) {
        console.error('Failed to delete competition:', error);
        throw new Error(`Failed to delete competition: ${id}`);
      }
    });
  }

  async setActiveCompetition(id: string): Promise<void> {
    // Queued: this is a read-modify-write of competitions-index.json, the same
    // file `refreshIndexEntryIfNeeded` patches, so it must not interleave.
    await this.writeQueue(async () => {
      const index = await this.getCompetitionsIndex();

      // Set all to inactive
      index.competitions.forEach(comp => comp.isActive = false);

      // Set target as active
      const target = index.competitions.find(c => c.id === id);
      if (target) {
        target.isActive = true;
        index.activeCompetitionId = id;
        await this.saveCompetitionsIndex(index);
      } else {
        throw new Error(`Competition not found: ${id}`);
      }
    });
  }

  async getActiveCompetition(): Promise<Competition | null> {
    const index = await this.getCompetitionsIndex();

    if (!index.activeCompetitionId) {
      return null;
    }

    return this.getCompetition(index.activeCompetitionId);
  }

  // Cleanup Detection
  async detectCleanupCandidates(): Promise<CleanupCandidate[]> {
    const index = await this.getCompetitionsIndex();
    const candidates: CleanupCandidate[] = [];
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

    // Check for age-based candidates
    for (const comp of index.competitions) {
      const createdAt = new Date(comp.createdAt);
      if (createdAt < thirtyDaysAgo) {
        const estimatedSize = await this.estimateCompetitionSize(comp.id);
        candidates.push({
          competition: comp,
          reason: 'age',
          daysOld: Math.floor((now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000)),
          estimatedSizeMB: estimatedSize
        });
      }
    }

    // Check for excess candidates (>10 competitions)
    if (index.competitions.length > MAX_COMPETITIONS) {
      const sorted = [...index.competitions].sort((a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      const excessCount = index.competitions.length - MAX_COMPETITIONS;
      const excessCompetitions = sorted.slice(0, excessCount);

      for (const comp of excessCompetitions) {
        // Don't double-add if already in age candidates
        if (!candidates.find(c => c.competition.id === comp.id)) {
          const estimatedSize = await this.estimateCompetitionSize(comp.id);
          candidates.push({
            competition: comp,
            reason: 'excess',
            estimatedSizeMB: estimatedSize
          });
        }
      }
    }

    return candidates;
  }

  async performCleanup(candidates: CleanupCandidate[]): Promise<void> {
    for (const candidate of candidates) {
      await this.deleteCompetition(candidate.competition.id);
    }
  }

  // Migration from existing session
  async migrateExistingSession(session: ApiPhotoSession, defaultName: string): Promise<Competition> {
    // Create first competition from existing session
    return this.createCompetition(defaultName, session);
  }

  // Storage monitoring
  async getStorageStats(): Promise<StorageStats> {
    try {
      await this.ensureInitialized();
      const estimate = await this.storage!.getStorageEstimate();
      const usage = estimate?.usage || null;
      const quota = estimate?.quota || null;

      let percentUsed = null;
      let isLow = false;
      let isCritical = false;

      if (usage !== null && quota !== null && quota > 0) {
        percentUsed = Math.round((usage / quota) * 100);
        isLow = percentUsed >= 80;
        isCritical = percentUsed >= 95;
      }

      return {
        usedBytes: usage,
        quotaBytes: quota,
        percentUsed,
        isLow,
        isCritical
      };
    } catch {
      return {
        usedBytes: null,
        quotaBytes: null,
        percentUsed: null,
        isLow: false,
        isCritical: false
      };
    }
  }

  // Estimate competition size
  private async estimateCompetitionSize(competitionId: string): Promise<number> {
    try {
      await this.ensureInitialized();
      const competitionDir = await this.storage!.getDirectoryHandle(
        this.competitionsDir!,
        competitionId,
        { create: false }
      );
      const photosDir = await this.storage!.getDirectoryHandle(
        competitionDir,
        'photos',
        { create: false }
      );

      let totalSize = 0;

      // Estimate session.json size (usually small)
      totalSize += 0.01; // ~10KB for session metadata

      // Estimate photos size by counting entries
      const entries = await this.storage!.listDirectory(photosDir);
      const photoCount = entries.filter(e => !e.isDirectory).length;
      totalSize += photoCount * 2; // ~2MB per photo estimate

      return Math.round(totalSize * 10) / 10; // Round to 1 decimal
    } catch {
      // Fallback estimation based on photo count
      const index = await this.getCompetitionsIndex();
      const comp = index.competitions.find(c => c.id === competitionId);
      return comp ? comp.photoCount * 2 : 0; // 2MB per photo estimate
    }
  }

  // Utility methods
  private calculatePhotoCount(session: ApiPhotoSession): number {
    return session.sets.set1.photos.length + session.sets.set2.photos.length;
  }

  private sanitizeSessionForStorage(session: ApiPhotoSession): ApiPhotoSession {
    // Overloaded so `sets` (required on ApiPhotoSession) keeps a non-optional
    // result while the optional per-mode buckets may still hand back
    // `undefined`. The `!sets` guard is kept rather than pushed onto callers:
    // an in-memory session that somehow lost `sets` must degrade the same way
    // it always has, not start throwing.
    function clearUrls(sets: ModeSets): ModeSets;
    function clearUrls(sets: ModeSets | undefined): ModeSets | undefined;
    function clearUrls(sets?: ModeSets): ModeSets | undefined {
      if (!sets) return undefined;
      return {
        set1: {
          ...sets.set1,
          photos: (sets.set1?.photos || []).map((p) => ({ ...p, url: '' }))
        },
        set2: {
          ...sets.set2,
          photos: (sets.set2?.photos || []).map((p) => ({ ...p, url: '' }))
        }
      };
    }

    // Candidate pool uses the same URL-stripping pass. The pool is a flat
    // `{ photos: [] }` shape so it's not symmetric with `{ set1, set2 }` and
    // can't share the helper above.
    const clearCandidateUrls = (pool: CandidatePool): CandidatePool =>
      ({ photos: (pool.photos || []).map((p) => ({ ...p, url: '' })) });

    return {
      ...session,
      sets: clearUrls(session.sets),
      ...(session.setsTrack ? { setsTrack: clearUrls(session.setsTrack) } : {}),
      ...(session.setsTurning ? { setsTurning: clearUrls(session.setsTurning) } : {}),
      ...(session.candidates ? { candidates: clearCandidateUrls(session.candidates) } : {})
    };
  }

  private async saveSessionPhotos(session: ApiPhotoSession, photosDir: DirectoryHandle): Promise<void> {
    await this.ensureInitialized();

    // Storage strategy: do NOT clear directory to avoid removing photos
    // from the non-active mode bucket. Persist any photos that have fresh
    // blob URLs; previously saved files remain available for loading.

    // Collect photos across active sets and both mode buckets
    const collect = (sets?: ModeSets): ApiPhoto[] =>
      sets ? [...(sets.set1?.photos || []), ...(sets.set2?.photos || [])] : [];

    const activePhotos = collect(session.sets);
    const trackPhotos = collect(session.setsTrack);
    const turningPhotos = collect(session.setsTurning);
    const candidatePhotos = session.candidates?.photos || [];

    // Deduplicate by id while preserving first occurrence with a blob url if available
    const idToPhoto = new Map<string, ApiPhoto>();
    const pushPhoto = (p: ApiPhoto) => {
      if (!p || !p.id) return;
      // Single `get` instead of `has` + `get`: the map never stores
      // `undefined`, so a miss and an absent key are the same thing, and this
      // avoids an assertion on the second lookup.
      const existing = idToPhoto.get(p.id);
      if (!existing) {
        idToPhoto.set(p.id, p);
        return;
      }
      // Prefer whichever copy still carries a live blob URL — only those can
      // actually be fetched and written to disk in the loop below.
      if ((!existing.url || !existing.url.startsWith('blob:')) && p.url && p.url.startsWith('blob:')) {
        idToPhoto.set(p.id, p);
      }
    };

    [...activePhotos, ...trackPhotos, ...turningPhotos, ...candidatePhotos].forEach(pushPhoto);

    for (const photo of idToPhoto.values()) {
      if (photo.url && photo.url.startsWith('blob:')) {
        try {
          const response = await fetch(photo.url);
          const blob = await response.blob();
          const file = new File([blob], photo.filename, { type: blob.type });
          await this.storage!.savePhotoFile(photosDir, photo.id, file);
        } catch (error) {
          console.warn(`Failed to save photo ${photo.id}:`, error);
        }
      }
    }
  }

  private async loadSessionPhotos(session: ApiPhotoSession, photosDir: DirectoryHandle): Promise<ApiPhotoSession> {
    await this.ensureInitialized();

    const loadPhotoUrls = async (photos: ApiPhoto[]): Promise<ApiPhoto[]> => {
      const updatedPhotos: ApiPhoto[] = [];
      for (const photo of photos) {
        try {
          const blob = await this.storage!.getPhotoBlob(photosDir, photo.id);
          const url = URL.createObjectURL(blob);
          updatedPhotos.push({ ...photo, url });
        } catch {
          // Photo file not found, keep without URL
          updatedPhotos.push({ ...photo, url: '' });
        }
      }
      return updatedPhotos;
    };

    // Load blob URLs for mode-specific sets as well
    const loadModeSpecificSets = async (sets: ModeSets | undefined): Promise<ModeSets | undefined> => {
      if (!sets) return undefined;
      return {
        set1: {
          ...sets.set1,
          photos: await loadPhotoUrls(sets.set1.photos || [])
        },
        set2: {
          ...sets.set2,
          photos: await loadPhotoUrls(sets.set2.photos || [])
        }
      };
    };

    // Candidates pool — flat array, not the {set1, set2} shape. Reuses the
    // same blob-load helper as slot photos. Missing pool stays missing
    // (older sessions on disk have no candidates field).
    const loadCandidates = async (pool: CandidatePool | undefined): Promise<CandidatePool | undefined> => {
      if (!pool) return undefined;
      return { photos: await loadPhotoUrls(pool.photos || []) };
    };

    return {
      ...session,
      sets: {
        set1: {
          ...session.sets.set1,
          photos: await loadPhotoUrls(session.sets.set1.photos)
        },
        set2: {
          ...session.sets.set2,
          photos: await loadPhotoUrls(session.sets.set2.photos)
        }
      },
      setsTrack: await loadModeSpecificSets(session.setsTrack),
      setsTurning: await loadModeSpecificSets(session.setsTurning),
      candidates: await loadCandidates(session.candidates)
    };
  }
}

// Singleton instance
export const competitionService = new CompetitionService();
