import { describe, it, expect } from 'vitest';
import { insertPlaceholderIntoSet } from '../utils/candidateTransitions';
import { createPlaceholderPhoto, PLACEHOLDER_ID_PREFIX, isPlaceholderId } from '../utils/placeholderPhoto';
import type { ApiPhoto, ApiPhotoSession } from '../types/api';

function makePhoto(id: string): ApiPhoto {
  return {
    id,
    sessionId: 'sess-1',
    url: `blob:${id}`,
    filename: `${id}.jpg`,
    canvasState: {
      position: { x: 0, y: 0 }, scale: 1, brightness: 0, contrast: 1, sharpness: 0,
      whiteBalance: { temperature: 0, tint: 0, auto: false }, labelPosition: 'bottom-left',
    } as ApiPhoto['canvasState'],
    label: '',
  };
}

function makeTurningSession(set1: ApiPhoto[], set2: ApiPhoto[] = []): ApiPhotoSession {
  return {
    id: 'sess-1', version: 1, createdAt: 'x', updatedAt: 'x', mode: 'turningpoint',
    competition_name: 'Test',
    sets: { set1: { title: '', photos: set1 }, set2: { title: '', photos: set2 } },
    candidates: { photos: [] },
  } as ApiPhotoSession;
}

describe('createPlaceholderPhoto', () => {
  it('builds a blank, image-less placeholder photo', () => {
    const p = createPlaceholderPhoto('sess-1', 'Bez fotky');
    expect(p.isPlaceholder).toBe(true);
    expect(p.url).toBe('');
    expect(p.filename).toBe('Bez fotky');
    expect(p.label).toBe('');
    expect(p.id.startsWith(PLACEHOLDER_ID_PREFIX)).toBe(true);
    expect(isPlaceholderId(p.id)).toBe(true);
    expect(p.canvasState).toBeTruthy();
  });

  it('gives each placeholder a unique id', () => {
    expect(createPlaceholderPhoto('s', 'x').id).not.toBe(createPlaceholderPhoto('s', 'x').id);
  });
});

describe('insertPlaceholderIntoSet', () => {
  it('inserts at the slot index, pushing later photos down (numbering preserved)', () => {
    const session = makeTurningSession([makePhoto('a'), makePhoto('b'), makePhoto('c')]);
    const ph = createPlaceholderPhoto('sess-1', 'Bez fotky');
    const next = insertPlaceholderIntoSet(session, 'set1', 1, ph);
    expect(next.sets.set1.photos.map((p) => p.id)).toEqual(['a', ph.id, 'b', 'c']);
    expect(next.sets.set1.photos[1].isPlaceholder).toBe(true);
    expect(next.version).toBe(session.version + 1);
  });

  it('clamps an out-of-range index (past end → append, negative → 0)', () => {
    const session = makeTurningSession([makePhoto('a'), makePhoto('b')]);
    const ph1 = createPlaceholderPhoto('s', 'x');
    expect(insertPlaceholderIntoSet(session, 'set1', 99, ph1).sets.set1.photos.map((p) => p.id))
      .toEqual(['a', 'b', ph1.id]);
    const ph2 = createPlaceholderPhoto('s', 'x');
    expect(insertPlaceholderIntoSet(session, 'set1', -5, ph2).sets.set1.photos.map((p) => p.id))
      .toEqual([ph2.id, 'a', 'b']);
  });

  it('mirrors into the active mode bucket (setsTurning === sets)', () => {
    const session = makeTurningSession([makePhoto('a')]);
    const next = insertPlaceholderIntoSet(session, 'set1', 0, createPlaceholderPhoto('s', 'x')) as unknown as {
      setsTurning: unknown; sets: unknown;
    };
    expect(next.setsTurning).toEqual(next.sets);
  });

  it('does not mutate the input session', () => {
    const session = makeTurningSession([makePhoto('a'), makePhoto('b')]);
    insertPlaceholderIntoSet(session, 'set1', 1, createPlaceholderPhoto('s', 'x'));
    expect(session.sets.set1.photos.map((p) => p.id)).toEqual(['a', 'b']);
  });
});
