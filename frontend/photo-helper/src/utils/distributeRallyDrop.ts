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
 * `RALLY_TURNING_PER_SET` files) and set2 (the remainder). Without this
 * the set1 grid silently swallowed files 10+ on a 10+ photo drop
 * (feedback 2026-04-23).
 *
 * Rally rules allow up to 18 turning points (= SP + 18 TP + FP = 20
 * photos) per feedback 2026-05-03. Per-set capacity is therefore 10 in
 * BOTH orientations — the landscape grid auto-expands from 3×3 to 5×2
 * once a set reaches 10 photos. `layoutMode` is retained on the input
 * type for backward compatibility but no longer affects capacity.
 *
 * Exceeding the total returns `ok: false` so the caller can surface a
 * user-facing error instead of dropping files.
 */
export const RALLY_TURNING_PER_SET = 10;
export const RALLY_TURNING_MAX_TOTAL = RALLY_TURNING_PER_SET * 2;

export function distributeRallyDrop({
  files,
  set1Count,
  set2Count,
}: DistributeRallyDropInput): DistributeRallyDropResult {
  const gridCapacity = RALLY_TURNING_PER_SET;
  const maxTotal = RALLY_TURNING_MAX_TOTAL;
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
