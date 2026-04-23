export type RallyLayoutMode = 'landscape' | 'portrait';

export type DistributeRallyDropInput = {
  files: File[];
  layoutMode: RallyLayoutMode;
  set1Count: number;
  set2Count: number;
};

export type DistributeRallyDropResult =
  | { ok: true; toSet1: File[]; toSet2: File[]; maxTotal: number }
  | { ok: false; reason: 'overflow'; maxTotal: number; totalIfAdded: number };

/**
 * Distribute a Rally turning-point initial drop across set1 (first
 * `gridCapacity` files) and set2 (the remainder). Without this the 9-slot
 * set1 grid silently swallowed files 10+ on a 10–18-photo drop (feedback
 * 2026-04-23).
 *
 * Grid capacity is 9 in landscape and 10 in portrait — `maxTotal` is
 * therefore 18 or 20. Exceeding the total returns `ok: false` so the
 * caller can surface a user-facing error instead of dropping files.
 */
export function distributeRallyDrop({
  files,
  layoutMode,
  set1Count,
  set2Count,
}: DistributeRallyDropInput): DistributeRallyDropResult {
  const gridCapacity = layoutMode === 'portrait' ? 10 : 9;
  const maxTotal = gridCapacity * 2;
  const totalIfAdded = set1Count + set2Count + files.length;
  if (totalIfAdded > maxTotal) {
    return { ok: false, reason: 'overflow', maxTotal, totalIfAdded };
  }
  const set1Remaining = Math.max(0, gridCapacity - set1Count);
  return {
    ok: true,
    toSet1: files.slice(0, set1Remaining),
    toSet2: files.slice(set1Remaining),
    maxTotal,
  };
}
