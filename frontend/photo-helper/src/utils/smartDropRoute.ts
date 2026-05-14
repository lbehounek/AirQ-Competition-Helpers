/**
 * Smart drop routing — decides whether an incoming batch of files should
 * fill a target set's empty slots or land in the candidates pool.
 *
 * Contract: if the batch fits in the remaining slot capacity, fill slots
 * (today's behaviour). Otherwise the entire batch routes to candidates —
 * we never partially fill slots and dump the remainder, because that
 * silently splits the user's intent and is hard to undo.
 *
 * Pure helper so the heuristic stays unit-testable in isolation; see
 * docs/CANDIDATE_PHOTOS.md "Smart drop heuristic".
 */
export type DropRoute =
  | { kind: 'slot'; files: File[] }
  | { kind: 'tray'; files: File[] };

export interface SmartDropInput {
  files: File[];
  currentSlotCount: number;
  slotCapacity: number;
}

export function routeDrop(input: SmartDropInput): DropRoute {
  const { files, currentSlotCount, slotCapacity } = input;
  const remaining = Math.max(0, slotCapacity - currentSlotCount);
  if (files.length === 0) return { kind: 'slot', files: [] };
  if (files.length <= remaining) return { kind: 'slot', files };
  return { kind: 'tray', files };
}
