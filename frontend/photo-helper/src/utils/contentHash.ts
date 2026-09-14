// Re-import dedup for the editor's "Add photos" path (ADR-020). Mirrors
// map-corridors' import-side content hashing (SHA-1 of the file bytes) so the
// behaviour is consistent across the two apps, but operates on the editor's
// ApiPhoto session rather than the map's markers/tray. The two hash spaces are
// independent — the map→editor handoff does not carry a hash — so editor dedup
// only matches photos imported through the editor itself.

import type { ApiPhoto } from '../types/api';

/** SHA-1 hex of a file's bytes. Same algorithm as map-corridors' computeContentHash. */
export async function computeFileContentHash(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  // Hash a VIEW over the buffer, not the raw ArrayBuffer — matching
  // map-corridors' computeContentHash, which this is supposed to mirror.
  // `crypto.subtle.digest` validates its argument by internal type, so an
  // ArrayBuffer produced in a different realm (jsdom's File polyfill under
  // Node 20) is rejected with "2nd argument is not instance of ArrayBuffer,
  // Buffer, TypedArray, or DataView" — 19 tests fail in CI while passing on a
  // developer machine. A Uint8Array view costs nothing and is accepted
  // everywhere; browsers were never affected.
  const hash = await crypto.subtle.digest('SHA-1', new Uint8Array(buf));
  const bytes = new Uint8Array(hash);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

/** The minimal slice of a session the dedup needs — every place a photo can live. */
interface HashSourceSets {
  set1?: { photos?: ApiPhoto[] };
  set2?: { photos?: ApiPhoto[] };
}
export interface ContentHashSession {
  candidates?: { photos?: ApiPhoto[] };
  sets?: HashSourceSets;
  setsTrack?: HashSourceSets;
  setsTurning?: HashSourceSets;
}

/**
 * Every content hash already present in the session: the candidate tray plus
 * both slots of the active sets AND the inactive discipline buckets — so a
 * re-import is rejected no matter where the original currently lives.
 */
export function collectSessionContentHashes(session: ContentHashSession | null | undefined): Set<string> {
  const hashes = new Set<string>();
  if (!session) return hashes;
  const addFrom = (photos?: ApiPhoto[]) => {
    for (const p of photos ?? []) if (p.contentHash) hashes.add(p.contentHash);
  };
  addFrom(session.candidates?.photos);
  for (const sets of [session.sets, session.setsTrack, session.setsTurning]) {
    addFrom(sets?.set1?.photos);
    addFrom(sets?.set2?.photos);
  }
  return hashes;
}

export interface FileWithHash {
  file: File;
  contentHash: string;
}

/**
 * Split incoming files into the ones to keep and the duplicates to drop. A file
 * is a duplicate when its content hash matches one already in the session
 * (`existingHashes`) OR an earlier file in this same batch — first occurrence
 * wins, mirroring importPhotosToStorage. Hashing is sequential to keep that
 * "first wins" order deterministic; batches are small.
 */
export async function partitionFilesByContentHash(
  files: File[],
  existingHashes: ReadonlySet<string>,
): Promise<{ fresh: FileWithHash[]; duplicates: File[] }> {
  const seen = new Set<string>(existingHashes);
  const fresh: FileWithHash[] = [];
  const duplicates: File[] = [];
  for (const file of files) {
    const contentHash = await computeFileContentHash(file);
    if (seen.has(contentHash)) {
      duplicates.push(file);
    } else {
      seen.add(contentHash);
      fresh.push({ file, contentHash });
    }
  }
  return { fresh, duplicates };
}
