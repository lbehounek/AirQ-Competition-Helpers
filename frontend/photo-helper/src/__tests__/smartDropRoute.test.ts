import { describe, it, expect } from 'vitest';
import { routeDrop } from '../utils/smartDropRoute';

// Smart-drop heuristic — boundaries matter. The whole batch goes to one
// destination; we never partially fill slots and dump the remainder, because
// that silently splits the user's intent and is hard to undo. See
// docs/CANDIDATE_PHOTOS.md "Smart drop heuristic".

const fakeFiles = (n: number) => Array.from({ length: n }, (_, i) => new File([''], `f${i}.jpg`));

describe('routeDrop', () => {
  it('empty batch → slot route, empty files', () => {
    expect(routeDrop({ files: [], currentSlotCount: 0, slotCapacity: 9 }))
      .toEqual({ kind: 'slot', files: [] });
  });

  it('drop fits exactly into remaining slot capacity → slot', () => {
    const files = fakeFiles(4);
    const result = routeDrop({ files, currentSlotCount: 5, slotCapacity: 9 });
    expect(result.kind).toBe('slot');
    expect(result.files).toHaveLength(4);
  });

  it('drop one less than remaining → slot', () => {
    const files = fakeFiles(3);
    expect(routeDrop({ files, currentSlotCount: 5, slotCapacity: 9 }).kind).toBe('slot');
  });

  it('drop one MORE than remaining → tray (whole batch)', () => {
    const files = fakeFiles(5);
    const result = routeDrop({ files, currentSlotCount: 5, slotCapacity: 9 });
    expect(result.kind).toBe('tray');
    expect(result.files).toHaveLength(5);
  });

  it('drop into already-full set → tray', () => {
    const files = fakeFiles(2);
    const result = routeDrop({ files, currentSlotCount: 9, slotCapacity: 9 });
    expect(result.kind).toBe('tray');
    expect(result.files).toHaveLength(2);
  });

  it('drop of 30 into empty 9-slot set → tray', () => {
    const files = fakeFiles(30);
    const result = routeDrop({ files, currentSlotCount: 0, slotCapacity: 9 });
    expect(result.kind).toBe('tray');
    expect(result.files).toHaveLength(30);
  });

  it('drop of 9 into empty 9-slot set → slot (boundary)', () => {
    const files = fakeFiles(9);
    const result = routeDrop({ files, currentSlotCount: 0, slotCapacity: 9 });
    expect(result.kind).toBe('slot');
  });

  it('drop of 10 into empty 10-slot (portrait) set → slot (boundary)', () => {
    const files = fakeFiles(10);
    const result = routeDrop({ files, currentSlotCount: 0, slotCapacity: 10 });
    expect(result.kind).toBe('slot');
  });
});
