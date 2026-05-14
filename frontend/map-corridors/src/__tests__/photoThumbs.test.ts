import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import {
  savePhotoThumb,
  getPhotoThumb,
  deletePhotoThumb,
  type StorageInterface,
  type DirectoryHandle,
} from '@airq/shared-storage'

// Phase 2 of photo-map-culling (docs/photo-map-culling/implementation-plan.md).
// The thumb helpers are pure wrappers — they delegate to existing
// StorageInterface primitives, so testing them with a faked interface
// proves the behaviour for BOTH OPFS and Electron backends in one place.

const photosDir: DirectoryHandle = { path: '/sessions/comp-1/photos' }
const thumbsDir: DirectoryHandle = { path: '/sessions/comp-1/photos/thumbs' }

interface FakeStorage extends Pick<StorageInterface,
  'getDirectoryHandle' | 'savePhotoFile' | 'getPhotoBlob' | 'deletePhotoFile'> {
  getDirectoryHandle: Mock
  savePhotoFile: Mock
  getPhotoBlob: Mock
  deletePhotoFile: Mock
}

function fakeStorage(): FakeStorage {
  return {
    getDirectoryHandle: vi.fn().mockResolvedValue(thumbsDir),
    savePhotoFile: vi.fn().mockResolvedValue(undefined),
    getPhotoBlob: vi.fn(),
    deletePhotoFile: vi.fn().mockResolvedValue(undefined),
  }
}

describe('savePhotoThumb', () => {
  let storage: FakeStorage

  beforeEach(() => { storage = fakeStorage() })

  it('creates the thumbs/ subdirectory on first save', async () => {
    const blob = new Blob([new Uint8Array(64)], { type: 'image/jpeg' })
    await savePhotoThumb(storage as unknown as StorageInterface, photosDir, 'pm-abc', blob)
    expect(storage.getDirectoryHandle).toHaveBeenCalledWith(photosDir, 'thumbs', { create: true })
  })

  it('writes the blob as {photoId}.jpg', async () => {
    const blob = new Blob([new Uint8Array(64)], { type: 'image/jpeg' })
    await savePhotoThumb(storage as unknown as StorageInterface, photosDir, 'pm-abc', blob)
    expect(storage.savePhotoFile).toHaveBeenCalledTimes(1)
    const [actualDir, actualName, actualFile] = storage.savePhotoFile.mock.calls[0]
    expect(actualDir).toBe(thumbsDir)
    expect(actualName).toBe('pm-abc.jpg')
    expect(actualFile).toBeInstanceOf(File)
    expect(actualFile.name).toBe('pm-abc.jpg')
  })

  it('forwards the blob MIME type onto the File wrapper', async () => {
    const blob = new Blob([new Uint8Array(64)], { type: 'image/png' })
    await savePhotoThumb(storage as unknown as StorageInterface, photosDir, 'pm-abc', blob)
    const file = storage.savePhotoFile.mock.calls[0][2] as File
    expect(file.type).toBe('image/png')
  })

  it('defaults to image/jpeg when the blob has no type', async () => {
    const blob = new Blob([new Uint8Array(64)])
    await savePhotoThumb(storage as unknown as StorageInterface, photosDir, 'pm-abc', blob)
    const file = storage.savePhotoFile.mock.calls[0][2] as File
    expect(file.type).toBe('image/jpeg')
  })

  it('propagates errors from savePhotoFile (caller should know writes failed)', async () => {
    storage.savePhotoFile.mockRejectedValue(new Error('disk full'))
    const blob = new Blob([new Uint8Array(64)], { type: 'image/jpeg' })
    await expect(
      savePhotoThumb(storage as unknown as StorageInterface, photosDir, 'pm-abc', blob),
    ).rejects.toThrow('disk full')
  })
})

describe('getPhotoThumb', () => {
  let storage: FakeStorage

  beforeEach(() => { storage = fakeStorage() })

  it('returns the blob when the thumb exists', async () => {
    const stored = new Blob([new Uint8Array(64)], { type: 'image/jpeg' })
    storage.getPhotoBlob.mockResolvedValue(stored)
    const result = await getPhotoThumb(storage as unknown as StorageInterface, photosDir, 'pm-abc')
    expect(result).toBe(stored)
    expect(storage.getDirectoryHandle).toHaveBeenCalledWith(photosDir, 'thumbs', { create: false })
    expect(storage.getPhotoBlob).toHaveBeenCalledWith(thumbsDir, 'pm-abc.jpg')
  })

  it('returns null when the thumbs subdirectory does not exist yet', async () => {
    storage.getDirectoryHandle.mockRejectedValue(new Error('NotFoundError'))
    expect(await getPhotoThumb(storage as unknown as StorageInterface, photosDir, 'pm-abc')).toBeNull()
    expect(storage.getPhotoBlob).not.toHaveBeenCalled()
  })

  it('returns null when the thumbs subdir exists but the file is missing', async () => {
    storage.getPhotoBlob.mockRejectedValue(new Error('NotFoundError'))
    expect(await getPhotoThumb(storage as unknown as StorageInterface, photosDir, 'pm-missing')).toBeNull()
  })

  it('never auto-creates the thumbs subdir on read (avoid unintended side effects)', async () => {
    storage.getPhotoBlob.mockResolvedValue(new Blob([]))
    await getPhotoThumb(storage as unknown as StorageInterface, photosDir, 'pm-abc')
    const [, , opts] = storage.getDirectoryHandle.mock.calls[0]
    expect(opts).toEqual({ create: false })
  })
})

describe('deletePhotoThumb', () => {
  let storage: FakeStorage

  beforeEach(() => { storage = fakeStorage() })

  it('deletes the {photoId}.jpg file in thumbs/', async () => {
    await deletePhotoThumb(storage as unknown as StorageInterface, photosDir, 'pm-abc')
    expect(storage.getDirectoryHandle).toHaveBeenCalledWith(photosDir, 'thumbs', { create: false })
    expect(storage.deletePhotoFile).toHaveBeenCalledWith(thumbsDir, 'pm-abc.jpg')
  })

  it('is idempotent: missing thumbs subdir is NOT an error', async () => {
    storage.getDirectoryHandle.mockRejectedValue(new Error('NotFoundError'))
    await expect(
      deletePhotoThumb(storage as unknown as StorageInterface, photosDir, 'pm-abc'),
    ).resolves.toBeUndefined()
    expect(storage.deletePhotoFile).not.toHaveBeenCalled()
  })

  it('is idempotent: missing thumb file is NOT an error', async () => {
    storage.deletePhotoFile.mockRejectedValue(new Error('NotFoundError'))
    await expect(
      deletePhotoThumb(storage as unknown as StorageInterface, photosDir, 'pm-missing'),
    ).resolves.toBeUndefined()
  })

  it('never auto-creates the thumbs subdir on delete', async () => {
    await deletePhotoThumb(storage as unknown as StorageInterface, photosDir, 'pm-abc')
    const [, , opts] = storage.getDirectoryHandle.mock.calls[0]
    expect(opts).toEqual({ create: false })
  })
})

describe('round-trip', () => {
  it('save then get returns the same blob bytes', async () => {
    // Simulate a tiny in-memory backend: writes land in a Map, reads serve
    // from it. This proves the helpers wire the same photoId to the same
    // storage key across the pair.
    const fakeFs = new Map<string, File>()
    const storage = {
      getDirectoryHandle: vi.fn().mockResolvedValue(thumbsDir),
      savePhotoFile: vi.fn(async (_dir: DirectoryHandle, name: string, file: File) => {
        fakeFs.set(name, file)
      }),
      getPhotoBlob: vi.fn(async (_dir: DirectoryHandle, name: string) => {
        const file = fakeFs.get(name)
        if (!file) throw new Error('NotFoundError')
        return file
      }),
      deletePhotoFile: vi.fn(async (_dir: DirectoryHandle, name: string) => {
        if (!fakeFs.delete(name)) throw new Error('NotFoundError')
      }),
    } as unknown as StorageInterface

    const original = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/jpeg' })
    await savePhotoThumb(storage, photosDir, 'pm-rt', original)

    const fetched = await getPhotoThumb(storage, photosDir, 'pm-rt')
    expect(fetched).not.toBeNull()
    expect(await fetched!.arrayBuffer()).toEqual(await original.arrayBuffer())

    await deletePhotoThumb(storage, photosDir, 'pm-rt')
    expect(await getPhotoThumb(storage, photosDir, 'pm-rt')).toBeNull()
  })
})
