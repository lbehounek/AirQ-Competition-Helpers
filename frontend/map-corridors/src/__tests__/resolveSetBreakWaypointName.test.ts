import { describe, it, expect, vi } from 'vitest'
import { resolveSetBreakWaypointName } from '../hooks/useCorridorSessionOPFS'

describe('resolveSetBreakWaypointName (untrusted session load)', () => {
  it('keeps a non-empty string waypoint name', () => {
    expect(resolveSetBreakWaypointName({ setBreakWaypointName: 'TP4' })).toBe('TP4')
  })

  it('returns null for absent / null (no break)', () => {
    expect(resolveSetBreakWaypointName({})).toBeNull()
    expect(resolveSetBreakWaypointName({ setBreakWaypointName: null })).toBeNull()
    expect(resolveSetBreakWaypointName(undefined)).toBeNull()
  })

  it('clears a wrong-typed corrupt value (number/object/empty) and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveSetBreakWaypointName({ setBreakWaypointName: 42 })).toBeNull()
    expect(resolveSetBreakWaypointName({ setBreakWaypointName: {} })).toBeNull()
    expect(resolveSetBreakWaypointName({ setBreakWaypointName: '' })).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
