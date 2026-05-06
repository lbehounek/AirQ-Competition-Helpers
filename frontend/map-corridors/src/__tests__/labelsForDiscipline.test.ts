import { describe, it, expect } from 'vitest'
import {
  getLabelsForDiscipline,
  PHOTO_LABELS_LETTERS,
  PHOTO_LABELS_NUMBERS,
} from '../types/markers'

// Precision flying rules require photos to be labelled with numbers
// (1, 2, 3...). Rally / web / legacy stays on letters (A, B, C...).
// This mirrors photo-helper's `resolveDefaultLabeling` so a marker drop in
// map-corridors offers exactly the labels printed on the photos.

describe('getLabelsForDiscipline', () => {
  it('returns numeric labels (1..20) for precision', () => {
    expect(getLabelsForDiscipline('precision')).toEqual(PHOTO_LABELS_NUMBERS)
  })

  it('returns letter labels (A..T) for rally', () => {
    expect(getLabelsForDiscipline('rally')).toEqual(PHOTO_LABELS_LETTERS)
  })

  it('letters and numbers are both 20 long — match the precision track-set cap', () => {
    expect(PHOTO_LABELS_LETTERS).toHaveLength(20)
    expect(PHOTO_LABELS_NUMBERS).toHaveLength(20)
  })

  it('letter and number sets are disjoint — sanitiser can keep both valid', () => {
    const letters = new Set<string>(PHOTO_LABELS_LETTERS)
    for (const n of PHOTO_LABELS_NUMBERS) expect(letters.has(n)).toBe(false)
  })
})
