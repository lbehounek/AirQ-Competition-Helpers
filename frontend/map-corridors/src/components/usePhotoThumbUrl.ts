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

  useEffect(() => {
    let cancelled = false
    let urlToRevoke: string | null = null
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
        urlToRevoke = next
        setUrl(next)
        setState('ready')
      } catch {
        if (!cancelled) setState('missing')
      }
    })()
    return () => {
      cancelled = true
      if (urlToRevoke) URL.revokeObjectURL(urlToRevoke)
    }
  }, [storage, photosDir, photoId])

  return { url, state }
}
