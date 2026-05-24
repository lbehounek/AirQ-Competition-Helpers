// Full-resolution sibling of `usePhotoThumbUrl`. Used by PhotoCompareModal
// (Phase 12 — photo variants) where the 40x30 thumb is too small for a
// "pick the best of N" judgement call. Same URL.createObjectURL lifecycle
// discipline as the thumb hook — revocation is keyed on the URL state so
// React state and the live blob URL can never disagree in StrictMode.
//
// Kept separate from `usePhotoThumbUrl` (rather than parameterised) so the
// existing thumb call sites — popup, tray, list — don't have to opt into a
// new argument shape. The two hooks are a few lines each.

import { useEffect, useState } from 'react'
import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage'

export type FullPhotoState = 'loading' | 'ready' | 'missing'

export interface UsePhotoFullUrlResult {
  url: string | null
  state: FullPhotoState
}

export function usePhotoFullUrl(
  storage: StorageInterface | null,
  photosDir: DirectoryHandle | null,
  photoId: string,
): UsePhotoFullUrlResult {
  const [url, setUrl] = useState<string | null>(null)
  const [state, setState] = useState<FullPhotoState>('loading')

  useEffect(() => {
    let cancelled = false
    if (!storage || !photosDir) {
      setUrl(null)
      setState('missing')
      return
    }
    setUrl(null)
    setState('loading')
    void (async () => {
      try {
        const blob = await storage.getPhotoBlob(photosDir, photoId)
        if (cancelled) return
        if (!blob) {
          // getPhotoBlob is typed to always resolve to a Blob, but the
          // Electron path can return null when the file is missing — guard
          // anyway so the UI shows "missing" rather than throwing.
          setState('missing')
          return
        }
        const next = URL.createObjectURL(blob)
        setUrl(next)
        setState('ready')
      } catch (err) {
        if (!cancelled) {
          console.warn('[usePhotoFullUrl] full-res load failed:', err)
          setState('missing')
        }
      }
    })()
    return () => { cancelled = true }
  }, [storage, photosDir, photoId])

  useEffect(() => {
    if (!url) return
    return () => { URL.revokeObjectURL(url) }
  }, [url])

  return { url, state }
}
