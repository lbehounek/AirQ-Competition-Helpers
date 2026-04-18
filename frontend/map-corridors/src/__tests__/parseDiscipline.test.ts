import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseDisciplineFromSearch } from '../utils/parseDiscipline'

// map-corridors returns `Discipline | null` so the caller can fall back
// to `session?.discipline` (the rally-vs-precision choice persists in the
// session, not just the URL). A silent downgrade would still mis-configure
// the 1-NM toggle and the corridor generator.

describe('parseDisciplineFromSearch', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('returns "precision" for ?discipline=precision', () => {
    expect(parseDisciplineFromSearch('?discipline=precision')).toBe('precision')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('returns "rally" for ?discipline=rally', () => {
    expect(parseDisciplineFromSearch('?discipline=rally')).toBe('rally')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('returns null when the param is absent (lets session discipline win)', () => {
    expect(parseDisciplineFromSearch('')).toBeNull()
    expect(parseDisciplineFromSearch('?other=1')).toBeNull()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('returns null for empty ?discipline= without logging', () => {
    // Empty string is "unset" semantically, not "invalid" — same as absent.
    expect(parseDisciplineFromSearch('?discipline=')).toBeNull()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('returns null AND logs for mixed-case or typo values', () => {
    expect(parseDisciplineFromSearch('?discipline=Precision')).toBeNull()
    expect(parseDisciplineFromSearch('?discipline=RALLY')).toBeNull()
    expect(parseDisciplineFromSearch('?discipline=precsn')).toBeNull()
    expect(errorSpy).toHaveBeenCalledTimes(3)
  })
})
