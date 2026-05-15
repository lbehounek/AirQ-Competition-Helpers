import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage'
import type { ApiPhoto } from '../types/api'
import {
  buildEditorPicks,
  scheduleWriteEditorPicks,
  flushPendingEditorPicks,
  _resetEditorPicksWriterForTests,
  type EditorPicksFile,
} from '../handoff/editorPicksWriter'

function photo(over: Partial<ApiPhoto> = {}): ApiPhoto {
  return {
    id: 'pm-1', sessionId: '', url: 'blob:x', filename: 'a.jpg',
    canvasState: {
      position: { x: 0, y: 0 }, scale: 1, brightness: 0, contrast: 1, sharpness: 0,
      whiteBalance: { temperature: 0, tint: 0, auto: false },
      labelPosition: 'bottom-left',
    },
    label: '',
    ...over,
  }
}

describe('buildEditorPicks', () => {
  it('skips photos without pm- prefix (photo-helper-originated)', () => {
    expect(buildEditorPicks([photo({ id: 'photo-helper-own', label: 'A', labelUpdatedAt: 'x' })])).toEqual([])
  })

  it('skips photos without labelUpdatedAt (can\'t resolve conflicts without a timestamp)', () => {
    expect(buildEditorPicks([photo({ id: 'pm-abc', label: 'A' })])).toEqual([])
  })

  it('emits photoId, label, labelUpdatedAt for pm- photos that have been labelled', () => {
    const result = buildEditorPicks([photo({
      id: 'pm-abc', label: 'A', labelUpdatedAt: '2024-01-01T00:00:00Z',
    })])
    expect(result).toEqual([{
      photoId: 'pm-abc', label: 'A', labelUpdatedAt: '2024-01-01T00:00:00Z',
    }])
  })

  it('treats empty-string label as a deliberate value (clear), still emits if labelUpdatedAt is set', () => {
    const result = buildEditorPicks([photo({
      id: 'pm-abc', label: '', labelUpdatedAt: '2024-01-01T00:00:00Z',
    })])
    expect(result).toEqual([{ photoId: 'pm-abc', label: '', labelUpdatedAt: '2024-01-01T00:00:00Z' }])
  })
})

describe('scheduleWriteEditorPicks — debounce', () => {
  let storage: { writeJSON: Mock }
  let dir: DirectoryHandle

  beforeEach(() => {
    vi.useFakeTimers()
    storage = { writeJSON: vi.fn().mockResolvedValue(undefined) }
    dir = { path: '/competitions/c-1' }
    _resetEditorPicksWriterForTests()
  })
  afterEach(() => {
    vi.useRealTimers()
    _resetEditorPicksWriterForTests()
  })

  it('does not write before 300 ms elapse', async () => {
    scheduleWriteEditorPicks(storage as unknown as StorageInterface, dir, [])
    await vi.advanceTimersByTimeAsync(299)
    expect(storage.writeJSON).not.toHaveBeenCalled()
  })

  it('writes once after 300 ms', async () => {
    scheduleWriteEditorPicks(storage as unknown as StorageInterface, dir, [])
    await vi.advanceTimersByTimeAsync(300)
    expect(storage.writeJSON).toHaveBeenCalledTimes(1)
  })

  it('coalesces — latest data wins', async () => {
    scheduleWriteEditorPicks(storage as unknown as StorageInterface, dir, [
      { photoId: 'pm-1', label: 'A', labelUpdatedAt: 't1' },
    ])
    await vi.advanceTimersByTimeAsync(100)
    scheduleWriteEditorPicks(storage as unknown as StorageInterface, dir, [
      { photoId: 'pm-1', label: 'B', labelUpdatedAt: 't2' },
    ])
    await vi.advanceTimersByTimeAsync(300)
    expect(storage.writeJSON).toHaveBeenCalledTimes(1)
    const file = storage.writeJSON.mock.calls[0][2] as EditorPicksFile
    expect(file.picks[0].label).toBe('B')
  })

  it('writes to photo-helper-picks.json with version=1 + ISO updatedAt', async () => {
    scheduleWriteEditorPicks(storage as unknown as StorageInterface, dir, [])
    await vi.advanceTimersByTimeAsync(300)
    const [actualDir, actualName, file] = storage.writeJSON.mock.calls[0]
    expect(actualDir).toBe(dir)
    expect(actualName).toBe('photo-helper-picks.json')
    expect((file as EditorPicksFile).version).toBe(1)
    expect(typeof (file as EditorPicksFile).updatedAt).toBe('string')
  })
})

describe('flushPendingEditorPicks', () => {
  let storage: { writeJSON: Mock }
  let dir: DirectoryHandle

  beforeEach(() => {
    vi.useFakeTimers()
    storage = { writeJSON: vi.fn().mockResolvedValue(undefined) }
    dir = { path: '/competitions/c-1' }
    _resetEditorPicksWriterForTests()
  })
  afterEach(() => {
    vi.useRealTimers()
    _resetEditorPicksWriterForTests()
  })

  it('executes the pending write immediately', async () => {
    scheduleWriteEditorPicks(storage as unknown as StorageInterface, dir, [])
    expect(storage.writeJSON).not.toHaveBeenCalled()
    await flushPendingEditorPicks()
    expect(storage.writeJSON).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when nothing pending', async () => {
    await expect(flushPendingEditorPicks()).resolves.toBeUndefined()
    expect(storage.writeJSON).not.toHaveBeenCalled()
  })

  it('cancels the debounce timer — no second write fires', async () => {
    scheduleWriteEditorPicks(storage as unknown as StorageInterface, dir, [])
    await flushPendingEditorPicks()
    await vi.advanceTimersByTimeAsync(1000)
    expect(storage.writeJSON).toHaveBeenCalledTimes(1)
  })
})
