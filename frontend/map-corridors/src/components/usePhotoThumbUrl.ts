// Shared thumbnail loader for photo-map-culling UI surfaces (popup, tray,
// list panel). Owns the URL.createObjectURL lifecycle — revokes on unmount
// and on every reload to avoid leaking blob URLs across rapid mounts (e.g.,
// the user scrubbing through the tray's horizontal scroll).

import { useEffect, useState } from 'react'
import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage'

export type ThumbState = 'loading' | 'ready' | 'missing'

export interface UsePhotoThumbUrlResult {
  url: string | null
  state: ThumbState
}

export function usePhotoThumbUrl(
  storage: StorageInterface | null,
  photosDir: DirectoryHandle | null,
  photoId: string,
): UsePhotoThumbUrlResult {
  const [url, setUrl] = useState<string | null>(null)
  const [state, setState] = useState<ThumbState>('loading')

  // Loader effect: resolves a blob URL and pushes it into React state.
  // Intentionally does NOT revoke on cleanup — the revocation lives in
  // the [url]-keyed effect below, so React-state and the live blob URL
  // can never disagree (StrictMode dev double-invocation included).
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
        const blob = await storage.getPhotoThumb(photosDir, photoId)
        if (cancelled) return
        if (!blob) {
          setState('missing')
          return
        }
        const next = URL.createObjectURL(blob)
        setUrl(next)
        setState('ready')
      } catch (err) {
        // Log unexpected failures so a degraded storage state surfaces
        // somewhere instead of silently rendering "missing" everywhere
        // (e.g. permission revoked, OPFS InvalidStateError).
        if (!cancelled) {
          console.warn('[usePhotoThumbUrl] thumb load failed:', err)
          setState('missing')
        }
      }
    })()
    return () => { cancelled = true }
  }, [storage, photosDir, photoId])

  // Revocation effect: revokes the previous URL whenever React state
  // moves to a new one (or the component unmounts). Tying revocation to
  // the URL state — not to the loader effect's cleanup — guarantees we
  // never revoke a URL that is still rendered.
  useEffect(() => {
    if (!url) return
    return () => { URL.revokeObjectURL(url) }
  }, [url])

  return { url, state }
}
