import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage'
import { importPhotosToStorage } from '../photoImport/importPhotosToStorage'
import { importPhotoFiles } from '../photoImport/importPhotoFiles'
import { HeicNotSupportedError } from '../photoImport/types'
import type { ImportedPhoto, ImportResult } from '../photoImport/types'

vi.mock('../photoImport/importPhotoFiles', () => ({
  importPhotoFiles: vi.fn(),
}))

const importPhotoFilesMock = importPhotoFiles as unknown as Mock

const photosDir: DirectoryHandle = { path: '/sessions/comp-1/photos' }

function makeFile(name: string): File {
  return new File([new Uint8Array(8)], name, { type: 'image/jpeg' })
}

function makePhoto(name: string): ImportedPhoto {
  const file = makeFile(name)
  return {
    photoId: `pm-${name}`,
    file,
    thumbnail: new Blob([new Uint8Array(32)], { type: 'image/jpeg' }),
    exif: {},
    contentHash: '0'.repeat(40),
  }
}

interface FakeStorage extends Pick<StorageInterface,
  'savePhotoFile' | 'savePhotoThumb' | 'deletePhotoFile'> {
  savePhotoFile: Mock
  savePhotoThumb: Mock
  deletePhotoFile: Mock
}

function fakeStorage(): FakeStorage {
  return {
    savePhotoFile: vi.fn().mockResolvedValue(undefined),
    savePhotoThumb: vi.fn().mockResolvedValue(undefined),
    deletePhotoFile: vi.fn().mockResolvedValue(undefined),
  }
}

beforeEach(() => {
  importPhotoFilesMock.mockReset()
})

describe('importPhotosToStorage — happy path', () => {
  it('persists each photo: blob first, then thumb', async () => {
    const photo = makePhoto('a.jpg')
    importPhotoFilesMock.mockResolvedValue({ ok: [photo], failed: [] } as ImportResult)
    const storage = fakeStorage()

    const result = await importPhotosToStorage(
      storage as unknown as StorageInterface,
      photosDir,
      [photo.file],
    )

    expect(result.ok).toEqual([photo])
    expect(result.failed).toEqual([])
    expect(storage.savePhotoFile).toHaveBeenCalledWith(photosDir, 'pm-a.jpg', photo.file)
    expect(storage.savePhotoThumb).toHaveBeenCalledWith(photosDir, 'pm-a.jpg', photo.thumbnail)
    // Order: blob write must complete before thumb write
    const blobCall = storage.savePhotoFile.mock.invocationCallOrder[0]
    const thumbCall = storage.savePhotoThumb.mock.invocationCallOrder[0]
    expect(blobCall).toBeLessThan(thumbCall)
  })

  it('processes multiple photos in parallel and preserves all on success', async () => {
    const photos = [makePhoto('a.jpg'), makePhoto('b.jpg'), makePhoto('c.jpg')]
    importPhotoFilesMock.mockResolvedValue({ ok: photos, failed: [] } as ImportResult)
    const storage = fakeStorage()

    const result = await importPhotosToStorage(
      storage as unknown as StorageInterface,
      photosDir,
      photos.map(p => p.file),
    )

    expect(result.ok).toHaveLength(3)
    expect(storage.savePhotoFile).toHaveBeenCalledTimes(3)
    expect(storage.savePhotoThumb).toHaveBeenCalledTimes(3)
  })

  it('forwards opts to importPhotoFiles', async () => {
    importPhotoFilesMock.mockResolvedValue({ ok: [], failed: [] } as ImportResult)
    const onProgress = vi.fn()
    await importPhotosToStorage(
      fakeStorage() as unknown as StorageInterface,
      photosDir,
      [],
      { concurrency: 4, onProgress },
    )
    expect(importPhotoFilesMock).toHaveBeenCalledWith(
      [],
      { concurrency: 4, onProgress },
    )
  })

  it('passes through pre-existing failures (HEIC, corrupt) without touching them', async () => {
    importPhotoFilesMock.mockResolvedValue({
      ok: [],
      failed: [
        { filename: 'apple.jpg', reason: 'heic', message: 'HEIC content' },
        { filename: 'broken.jpg', reason: 'corrupt', message: 'decode failed' },
      ],
    } as ImportResult)
    const storage = fakeStorage()

    const result = await importPhotosToStorage(
      storage as unknown as StorageInterface,
      photosDir,
      [],
    )

    expect(result.ok).toEqual([])
    expect(result.failed).toHaveLength(2)
    expect(result.failed[0].reason).toBe('heic')
    expect(result.failed[1].reason).toBe('corrupt')
    expect(storage.savePhotoFile).not.toHaveBeenCalled()
  })

  it('skips storage round-trip entirely when no imports succeeded', async () => {
    importPhotoFilesMock.mockResolvedValue({
      ok: [],
      failed: [{ filename: 'x.heic', reason: 'heic', message: '' }],
    } as ImportResult)
    const storage = fakeStorage()

    await importPhotosToStorage(storage as unknown as StorageInterface, photosDir, [])

    expect(storage.savePhotoFile).not.toHaveBeenCalled()
    expect(storage.savePhotoThumb).not.toHaveBeenCalled()
  })
})

describe('importPhotosToStorage — storage failures', () => {
  it('demotes a photo to failed when savePhotoFile throws', async () => {
    const photo = makePhoto('a.jpg')
    importPhotoFilesMock.mockResolvedValue({ ok: [photo], failed: [] } as ImportResult)
    const storage = fakeStorage()
    storage.savePhotoFile.mockRejectedValueOnce(new Error('quota exceeded'))

    const result = await importPhotosToStorage(
      storage as unknown as StorageInterface,
      photosDir,
      [photo.file],
    )

    expect(result.ok).toEqual([])
    expect(result.failed).toEqual([
      expect.objectContaining({
        filename: 'a.jpg',
        reason: 'storage',
        message: 'quota exceeded',
      }),
    ])
    expect(storage.savePhotoThumb).not.toHaveBeenCalled()
  })

  it('rolls back the blob when savePhotoThumb fails (ADR-013 atomicity)', async () => {
    const photo = makePhoto('a.jpg')
    importPhotoFilesMock.mockResolvedValue({ ok: [photo], failed: [] } as ImportResult)
    const storage = fakeStorage()
    storage.savePhotoThumb.mockRejectedValueOnce(new Error('thumb write failed'))

    const result = await importPhotosToStorage(
      storage as unknown as StorageInterface,
      photosDir,
      [photo.file],
    )

    expect(result.ok).toEqual([])
    expect(result.failed[0]).toEqual(expect.objectContaining({
      filename: 'a.jpg',
      reason: 'storage',
      message: 'thumb write failed',
    }))
    // Rollback: the orphan blob should have been deleted.
    expect(storage.deletePhotoFile).toHaveBeenCalledWith(photosDir, 'pm-a.jpg')
  })

  it('does not throw if rollback delete itself fails', async () => {
    const photo = makePhoto('a.jpg')
    importPhotoFilesMock.mockResolvedValue({ ok: [photo], failed: [] } as ImportResult)
    const storage = fakeStorage()
    storage.savePhotoThumb.mockRejectedValueOnce(new Error('thumb fail'))
    storage.deletePhotoFile.mockRejectedValueOnce(new Error('delete also fail'))

    // Should resolve, not reject — rollback is best-effort.
    const result = await importPhotosToStorage(
      storage as unknown as StorageInterface,
      photosDir,
      [photo.file],
    )
    expect(result.failed[0].message).toBe('thumb fail')
  })

  it('isolates per-photo storage failures: one fails, others still persist', async () => {
    const photos = [makePhoto('a.jpg'), makePhoto('b.jpg'), makePhoto('c.jpg')]
    importPhotoFilesMock.mockResolvedValue({ ok: photos, failed: [] } as ImportResult)
    const storage = fakeStorage()
    // Make middle photo's blob write fail
    storage.savePhotoFile.mockImplementation(async (_dir, photoId) => {
      if (photoId === 'pm-b.jpg') throw new Error('mid-batch fail')
    })

    const result = await importPhotosToStorage(
      storage as unknown as StorageInterface,
      photosDir,
      photos.map(p => p.file),
    )

    expect(result.ok.map(p => p.file.name).sort()).toEqual(['a.jpg', 'c.jpg'])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].filename).toBe('b.jpg')
  })

  it('uses non-Error exception messages verbatim', async () => {
    const photo = makePhoto('a.jpg')
    importPhotoFilesMock.mockResolvedValue({ ok: [photo], failed: [] } as ImportResult)
    const storage = fakeStorage()
    storage.savePhotoFile.mockRejectedValueOnce('plain string thrown')

    const result = await importPhotosToStorage(
      storage as unknown as StorageInterface,
      photosDir,
      [photo.file],
    )
    expect(result.failed[0].message).toBe('plain string thrown')
  })
})

describe('importPhotosToStorage — sanity', () => {
  it('still distinguishes HEIC failures from storage failures', async () => {
    // HEIC failure surfaces from importPhotoFiles (typed error); not
    // affected by the storage layer. Round-tripped through unchanged.
    importPhotoFilesMock.mockResolvedValue({
      ok: [],
      failed: [
        {
          filename: 'apple.jpg',
          reason: 'heic',
          message: new HeicNotSupportedError('apple.jpg').message,
        },
      ],
    } as ImportResult)
    const storage = fakeStorage()

    const result = await importPhotosToStorage(
      storage as unknown as StorageInterface,
      photosDir,
      [],
    )
    expect(result.failed[0].reason).toBe('heic')
  })
})
