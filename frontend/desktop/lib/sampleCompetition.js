// Bundled-sample competition bootstrap, extracted from `main.js` so it can be
// unit-tested without Electron (same pattern as `lib/pathValidation.js`).
//
// WHY ASYNC: the pre-built sample is a whole finalized competition — a
// session.json, map-picks.json and a photos/ directory of multi-megabyte JPEGs.
// `main.js` used to copy it *synchronously* inside `app.whenReady()`, before
// `createWindow()` ran, so every launch paid the copy before the first pixel.
// Here the copy is async and `main.js` starts it AFTER the window is created;
// the handful of IPC channels that observe the competitions index await the
// returned promise instead (see `afterSample` in main.js).
//
// WHY IT MATTERS ONLY TO DEVELOPER BUILDS: `sample-data/*` is gitignored at the
// repo root and neither build-desktop.yml nor e2e.yml populates it, so the
// GitHub Release .exe bundles no sample at all — there `ensureSampleCompetition`
// returns 'none' in microseconds. The reorder is a correctness/latency win for
// local builds and a no-op for end users.
//
// QUIT-DURING-COPY SELF-HEAL: the index entry is written LAST, so a quit in the
// middle of the copy leaves a partial `sample-plasy-blue/` directory that no
// index entry references. The next launch sees no entry (step 1), reaches the
// copy branch and `rm -rf`s the partial directory before re-copying. Nothing a
// user created is ever involved: this directory is only ever written by us.

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

// Fixed id for the always-present sample competition (recreated if deleted from
// the index — but never resurrected on disk, see step 1 of the algorithm).
// It intentionally does NOT start with `comp-`: photo-helper's
// `rebuildIndexFromDirs` (competitionService.ts:130) scans only `comp-*` dirs,
// so a rebuild of a lost index can never invent a second sample entry.
const SAMPLE_COMP_ID = 'sample-plasy-blue';
const SAMPLE_COMP_NAME = 'VZOR – Plasy Blue';

/**
 * Count the non-placeholder photos in a photo-helper session file's CONTENT.
 *
 * Takes the raw JSON text (not a path) so the function stays pure and testable.
 * Returns the number of distinct photo ids across `sets`, `setsTrack` and
 * `setsTurning` (set1 + set2); the same id appearing in several buckets counts
 * once, because those buckets are alternate views of one photo pool.
 *
 * Edge cases: malformed JSON, a missing bucket, a missing `set1`/`set2`, a null
 * entry, an entry with `isPlaceholder` or without an `id` all contribute 0 —
 * the count feeds a cosmetic launcher badge and must never throw.
 *
 * @param {string} sessionText raw contents of a session.json
 * @returns {number} distinct real photo count (0 on any parse failure)
 */
function countSessionPhotos(sessionText) {
  try {
    const s = JSON.parse(sessionText);
    const seen = new Set();
    for (const bucket of [s.sets, s.setsTrack, s.setsTurning]) {
      for (const key of ['set1', 'set2']) {
        for (const p of bucket?.[key]?.photos || []) {
          if (p && !p.isPlaceholder && p.id) seen.add(p.id);
        }
      }
    }
    return seen.size;
  } catch {
    return 0;
  }
}

/**
 * Build the empty photo-helper session used by the fallback branch (no
 * pre-built competition bundled, only the raw KML + photos that Map Corridors
 * imports on first open).
 *
 * The session id is derived from `now` rather than `Date.now()` so the function
 * stays single-argument and deterministic under test; `main.js` previously used
 * `Date.now()`, and `Date.parse(now)` reproduces exactly that value for the same
 * instant.
 *
 * @param {string} now ISO timestamp used for id, createdAt and updatedAt
 * @returns {object} session object matching competition-create's empty shape
 */
function buildEmptySampleSession(now) {
  return {
    id: `session-sample-${Date.parse(now)}`,
    version: 1,
    createdAt: now,
    updatedAt: now,
    mode: 'track',
    competition_name: SAMPLE_COMP_NAME,
    sets: { set1: { title: 'SP - TPX', photos: [] }, set2: { title: 'TPX - FP', photos: [] } },
    setsTrack: { set1: { title: 'SP - TPX', photos: [] }, set2: { title: 'TPX - FP', photos: [] } },
    setsTurning: { set1: { title: '', photos: [] }, set2: { title: '', photos: [] } },
  };
}

/**
 * Make sure the bundled sample competition is present in the competitions index
 * (when a sample is bundled at all). It is a NORMAL competition afterwards —
 * the user may open, edit or delete it.
 *
 * All Electron/filesystem-root knowledge is injected so the module stays pure:
 * @param {object} deps
 * @param {string} deps.sampleDataDir     resources/sample-data
 * @param {string} deps.competitionsDir   <userData>/photo-sessions/competitions
 * @param {string} deps.compDir           …/competitions/sample-plasy-blue (already validated)
 * @param {() => object} deps.readIndex   returns the parsed competitions index
 * @param {(index: object) => void} deps.writeIndex  persists the index (synchronously)
 * @param {() => boolean} deps.sampleAvailable  is any raw sample file bundled?
 * @param {() => string} [deps.now]       ISO timestamp source (default: new Date())
 * @param {{log: Function, warn: Function}} [deps.log]  logger (default: console)
 * @returns {Promise<'present'|'copied'|'pending'|'none'|'failed'>} what happened.
 *   NEVER rejects — callers await it as a readiness gate, and a rejection there
 *   would either hang or crash whichever IPC handler is waiting.
 */
async function ensureSampleCompetition(deps) {
  const {
    sampleDataDir,
    competitionsDir,
    compDir,
    readIndex,
    writeIndex,
    sampleAvailable,
    now = () => new Date().toISOString(),
    log = console,
  } = deps;

  // Only clean up a directory THIS run created. A failure must never delete a
  // directory we found already in place (that is the user's data as far as we
  // know), which is why this is a flag rather than an unconditional rm.
  let touchedCompDir = false;

  try {
    // (1) Already indexed → nothing to do, and deliberately NO disk access: a
    // user who deleted `sample-plasy-blue/` by hand while the entry survived
    // must not get the folder resurrected on every launch. This is parity with
    // the old sync implementation (main.js:481-482).
    if (readIndex().competitions.some(c => c.id === SAMPLE_COMP_ID)) return 'present';

    // (2) Parity with the old code, which ran `ensureDir(competitionsDir)`
    // before any branch — other code paths (and the e2e specs) rely on the
    // directory existing even when no sample is bundled.
    await fsp.mkdir(competitionsDir, { recursive: true });

    const prebuilt = path.join(sampleDataDir, 'competition');
    let hasPrebuilt = true;
    try {
      await fsp.access(path.join(prebuilt, 'session.json'));
    } catch {
      hasPrebuilt = false;
    }

    const ts = now();
    let entry;
    let outcome;

    if (hasPrebuilt) {
      // (3a) Copy the finalized competition verbatim — corridors session,
      // editor session.json, photos and map-picks.json. No pending marker.
      touchedCompDir = true;
      await fsp.rm(compDir, { recursive: true, force: true });
      await fsp.cp(prebuilt, compDir, { recursive: true });
      const photoCount = countSessionPhotos(
        await fsp.readFile(path.join(compDir, 'session.json'), 'utf8'),
      );
      entry = {
        id: SAMPLE_COMP_ID, name: SAMPLE_COMP_NAME, discipline: 'rally',
        createdAt: ts, lastModified: ts, photoCount, isActive: false,
      };
      outcome = 'copied';
    } else if (!sampleAvailable()) {
      // (3b) Nothing bundled at all — the release build's normal path.
      return 'none';
    } else {
      // (3c) Fallback: empty competition + a `.sample-pending` marker that Map
      // Corridors consumes on first open to import the raw sample files.
      touchedCompDir = true;
      await fsp.mkdir(path.join(compDir, 'photos'), { recursive: true });
      await fsp.writeFile(
        path.join(compDir, 'session.json'),
        JSON.stringify(buildEmptySampleSession(ts), null, 2),
        'utf8',
      );
      await fsp.writeFile(path.join(compDir, '.sample-pending'), '1', 'utf8');
      entry = {
        id: SAMPLE_COMP_ID, name: SAMPLE_COMP_NAME, discipline: 'rally',
        createdAt: ts, lastModified: ts, photoCount: 0, isActive: false,
      };
      outcome = 'pending';
    }

    // ---- ATOMIC SEGMENT: NO `await` between readIndex() and writeIndex() ----
    // Everything above (the copy, the photo count, every file write) is done
    // BEFORE this re-read, so the read→modify→write below is one synchronous
    // segment. Every main-process index writer (`competition-create`,
    // `competition-set-active`, rename, delete, set-discipline, set-working-dir)
    // is likewise synchronous fs inside a single IPC turn, so nothing can
    // interleave with it. Insert an `await` here and the lost-update race comes
    // straight back.
    //
    // The re-read is a MERGE, not a clobber: the copy can take seconds and the
    // launcher's "New competition" button is live the whole time
    // (renderer/index.html:49 does not disable it), so `competition-create` may
    // legitimately have appended an entry since step (1).
    const index = readIndex();
    if (!index.competitions.some(c => c.id === SAMPLE_COMP_ID)) {
      index.competitions.push(entry);
      writeIndex(index);
    }
    log.log(`[sample] ${outcome} (${entry.photoCount} photos)`);
    return outcome;
  } catch (e) {
    log.warn('[sample] ensureSampleCompetition failed:', e);
    if (touchedCompDir) {
      // Leave no half-copied directory behind — the next launch would find it
      // and, seeing no index entry, wipe and re-copy anyway; removing it now
      // keeps the on-disk state honest in the meantime.
      try { await fsp.rm(compDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    return 'failed';
  }
}

module.exports = {
  SAMPLE_COMP_ID,
  SAMPLE_COMP_NAME,
  countSessionPhotos,
  buildEmptySampleSession,
  ensureSampleCompetition,
};
