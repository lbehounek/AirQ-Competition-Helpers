import { useCallback, useEffect, useRef, useState } from 'react';
import type { Photo } from '../types';
import type { ApiPhoto, ApiPhotoSession } from '../types/api';
import {
  detectOPFSWriteSupport,
  initOPFS,
  ensureSessionDirs,
  writeJSON,
  readJSON,
  savePhotoFile,
  getPhotoBlob,
  deletePhotoFile,
  loadOrCreateSessionId,
} from '../services/opfsService';

type LayoutMode = 'landscape' | 'portrait';

const defaultSession = (id: string): ApiPhotoSession => ({
  id,
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  mode: 'track',
  competition_name: '',
  sets: {
    set1: { title: '', photos: [] },
    set2: { title: '', photos: [] },
  },
});

export function usePhotoSessionOPFS() {
  const [session, setSession] = useState<ApiPhotoSession | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opfsAvailable, setOpfsAvailable] = useState<boolean | null>(null);

  // Storage estimate
  const [storageQuotaBytes, setStorageQuotaBytes] = useState<number | null>(null);
  const [storageUsedBytes, setStorageUsedBytes] = useState<number | null>(null);
  const [storagePercentFree, setStoragePercentFree] = useState<number | null>(null);
  const [isStorageLow, setIsStorageLow] = useState<boolean>(false);

  const handlesRef = useRef<{
    sessionsDir?: FileSystemDirectoryHandle;
    sessionDir?: FileSystemDirectoryHandle;
    photosDir?: FileSystemDirectoryHandle;
  }>({});

  const objectURLsRef = useRef<Map<string, string>>(new Map());
  const revokeAllURLs = () => {
    for (const url of objectURLsRef.current.values()) URL.revokeObjectURL(url);
    objectURLsRef.current.clear();
  };

  useEffect(() => () => revokeAllURLs(), []);

  const getTrackTitles = useCallback(() => {
    return { set1: 'SP - TPX', set2: 'TPX - FP' };
  }, []);

  useEffect(() => {
    (async () => {
      setOpfsAvailable(null);
      const ok = await detectOPFSWriteSupport();
      setOpfsAvailable(ok);
      const id = loadOrCreateSessionId();
      setSessionId(id);

      if (!ok) {
        setSession(defaultSession(id));
        // Try storage estimate even if OPFS not available
        updateStorageEstimate();
        return;
      }

      try {
        const { sessions } = await initOPFS();
        const { dir, photos } = await ensureSessionDirs({ root: {} as any, sessions }, id);
        handlesRef.current = { sessionsDir: sessions, sessionDir: dir, photosDir: photos };
        const existing = await readJSON<ApiPhotoSession>(dir, 'session.json');
        if (existing) {
          // Ensure per-mode sets exist (migration)
          const sAny: any = existing as any;
          if (!sAny.setsTrack || !sAny.setsTurning) {
            const emptySets = { title: '', photos: [] } as any;
            const track = existing.mode === 'track' ? existing.sets : { set1: { ...emptySets }, set2: { ...emptySets } };
            const turning = existing.mode === 'turningpoint' ? existing.sets : { set1: { ...emptySets }, set2: { ...emptySets } };
            sAny.setsTrack = track;
            sAny.setsTurning = turning;
          }
          // Active sets mirror based on mode
          const active = existing.mode === 'track' ? (sAny.setsTrack as typeof existing.sets) : (sAny.setsTurning as typeof existing.sets);
          const withUrls: ApiPhotoSession = {
            ...(sAny as ApiPhotoSession),
            sets: {
              set1: { ...active.sets ? (active as any).sets.set1 : active.set1, photos: [...active.sets ? (active as any).sets.set1.photos : active.set1.photos] },
              set2: { ...active.sets ? (active as any).sets.set2 : active.set2, photos: [...active.sets ? (active as any).sets.set2.photos : active.set2.photos] },
            },
          };
          for (const p of withUrls.sets.set1.photos) {
            try { p.url = await getPhotoURL(p.id); } catch { p.url = ''; }
          }
          for (const p of withUrls.sets.set2.photos) {
            try { p.url = await getPhotoURL(p.id); } catch { p.url = ''; }
          }
          // Attach per-mode sets to in-memory state
          (withUrls as any).setsTrack = sAny.setsTrack;
          (withUrls as any).setsTurning = sAny.setsTurning;
          // Ensure track bucket has default titles
          if (!((withUrls as any).setsTrack?.set1?.title) || !((withUrls as any).setsTrack?.set2?.title)) {
            const titles = getTrackTitles();
            (withUrls as any).setsTrack.set1.title = (withUrls as any).setsTrack.set1.title || titles.set1;
            (withUrls as any).setsTrack.set2.title = (withUrls as any).setsTrack.set2.title || titles.set2;
          }
          setSession(withUrls);
        } else {
          const fresh = defaultSession(id);
          // Initialize per-mode stores
          const trackTitles = getTrackTitles();
          // Set defaults for track titles
          (fresh as any).sets = {
            set1: { title: trackTitles.set1, photos: [] },
            set2: { title: trackTitles.set2, photos: [] },
          };
          (fresh as any).setsTrack = (fresh as any).sets;
          // Turning point titles remain empty by default
          (fresh as any).setsTurning = { set1: { title: '', photos: [] }, set2: { title: '', photos: [] } };
          await writeJSON(dir, 'session.json', fresh);
          setSession(fresh);
        }
        updateStorageEstimate();
      } catch (e) {
        console.error(e);
        setError('Failed to initialize OPFS');
        setSession(defaultSession(id));
      }
    })();
  }, []);

  const getPhotoURL = useCallback(async (photoId: string): Promise<string> => {
    const cached = objectURLsRef.current.get(photoId);
    if (cached) return cached;
    const photosDir = handlesRef.current.photosDir;
    if (!photosDir) return '';
    const blob = await getPhotoBlob(photosDir, photoId);
    const url = URL.createObjectURL(blob);
    objectURLsRef.current.set(photoId, url);
    return url;
  }, []);

  const sanitizeForDisk = (s: ApiPhotoSession): ApiPhotoSession => ({
    ...s,
    sets: {
      set1: { ...s.sets.set1, photos: s.sets.set1.photos.map(p => ({ ...p, url: '' })) },
      set2: { ...s.sets.set2, photos: s.sets.set2.photos.map(p => ({ ...p, url: '' })) },
    },
    ...(s as any).setsTrack ? { setsTrack: {
      set1: { ...(s as any).setsTrack.set1, photos: (s as any).setsTrack.set1.photos.map((p: any) => ({ ...p, url: '' })) },
      set2: { ...(s as any).setsTrack.set2, photos: (s as any).setsTrack.set2.photos.map((p: any) => ({ ...p, url: '' })) },
    }} : {},
    ...(s as any).setsTurning ? { setsTurning: {
      set1: { ...(s as any).setsTurning.set1, photos: (s as any).setsTurning.set1.photos.map((p: any) => ({ ...p, url: '' })) },
      set2: { ...(s as any).setsTurning.set2, photos: (s as any).setsTurning.set2.photos.map((p: any) => ({ ...p, url: '' })) },
    }} : {},
  });

  const persistSession = useCallback(async (next: ApiPhotoSession) => {
    // Keep blob URLs in memory for rendering; write a sanitized copy to disk
    setSession(next);
    if (handlesRef.current.sessionDir) {
      try { await writeJSON(handlesRef.current.sessionDir, 'session.json', sanitizeForDisk(next)); } catch {}
    }
    updateStorageEstimate();
  }, []);

  // Update storage metrics
  const updateStorageEstimate = useCallback(async () => {
    try {
      const est: any = await (navigator as any).storage?.estimate?.();
      const usage = est?.usage ?? null;
      const quota = est?.quota ?? null;
      setStorageUsedBytes(usage);
      setStorageQuotaBytes(quota);
      if (usage != null && quota != null && quota > 0) {
        const free = Math.max(0, quota - usage);
        const percentFree = Math.round((free / quota) * 100);
        setStoragePercentFree(percentFree);
        setIsStorageLow(percentFree < 20);
      } else {
        setStoragePercentFree(null);
        setIsStorageLow(false);
      }
    } catch {
      setStoragePercentFree(null);
      setIsStorageLow(false);
    }
  }, []);

  const addPhotosToSet = useCallback(async (files: File[], setKey: 'set1' | 'set2') => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const gridCapacity = (session as any).layoutMode === 'portrait' ? 10 : 9;
      const current = session.sets[setKey].photos.length;
      if (current + files.length > gridCapacity) throw new Error(`Can only add ${gridCapacity - current} more photos to this set`);

      const photosDir = handlesRef.current.photosDir;
      const nowISO = new Date().toISOString();
      const newPhotos: ApiPhoto[] = [];
      for (const file of files) {
        if (file.size > 20 * 1024 * 1024) throw new Error('Image file too large (max 20MB)');
        const id = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        if (photosDir) {
          await savePhotoFile(photosDir, id, file);
          const url = await getPhotoURL(id);
          newPhotos.push({
            id,
            sessionId: session.id,
            url,
            filename: file.name,
            canvasState: {
              position: { x: 0, y: 0 },
              scale: 1,
              brightness: 0,
              contrast: 1,
              sharpness: 0,
              whiteBalance: { temperature: 0, tint: 0, auto: false },
              labelPosition: 'bottom-left',
            },
            label: '',
          });
        } else {
          const url = URL.createObjectURL(file);
          objectURLsRef.current.set(id, url);
          newPhotos.push({
            id,
            sessionId: session.id,
            url,
            filename: file.name,
            canvasState: {
              position: { x: 0, y: 0 },
              scale: 1,
              brightness: 0,
              contrast: 1,
              sharpness: 0,
              whiteBalance: { temperature: 0, tint: 0, auto: false },
              labelPosition: 'bottom-left',
            },
            label: '',
          });
        }
      }

      const next: ApiPhotoSession = {
        ...session,
        version: session.version + 1,
        updatedAt: nowISO,
        sets: {
          ...session.sets,
          [setKey]: { ...session.sets[setKey], photos: [...session.sets[setKey].photos, ...newPhotos] },
        },
      };
      // Mirror into per-mode store
      const modeKey = session.mode === 'track' ? 'setsTrack' : 'setsTurning';
      (next as any)[modeKey] = next.sets;
      await persistSession(next);
      await updateStorageEstimate();
    } catch (e: any) {
      setError(e?.message || 'Failed to add photos');
    } finally {
      setLoading(false);
    }
  }, [session, persistSession, getPhotoURL]);

  const removePhoto = useCallback(async (setKey: 'set1' | 'set2', photoId: string) => {
    if (!session) return;
    try {
      if (handlesRef.current.photosDir) await deletePhotoFile(handlesRef.current.photosDir, photoId);
      const url = objectURLsRef.current.get(photoId);
      if (url) { URL.revokeObjectURL(url); objectURLsRef.current.delete(photoId); }
      const next: ApiPhotoSession = {
        ...session,
        version: session.version + 1,
        updatedAt: new Date().toISOString(),
        sets: {
          ...session.sets,
          [setKey]: { ...session.sets[setKey], photos: session.sets[setKey].photos.filter(p => p.id !== photoId) },
        },
      };
      (next as any)[session.mode === 'track' ? 'setsTrack' : 'setsTurning'] = next.sets;
      await persistSession(next);
      await updateStorageEstimate();
    } catch {
      setError('Failed to delete photo');
    }
  }, [session, persistSession]);

  const updatePhotoState = useCallback(async (
    setKey: 'set1' | 'set2',
    photoId: string,
    canvasState: Partial<Photo['canvasState']>
  ) => {
    if (!session) return;
    const next: ApiPhotoSession = {
      ...session,
      version: session.version + 1,
      updatedAt: new Date().toISOString(),
      sets: {
        ...session.sets,
        [setKey]: {
          ...session.sets[setKey],
          photos: session.sets[setKey].photos.map(p => p.id === photoId ? { ...p, canvasState: { ...p.canvasState, ...canvasState } } : p),
        },
      },
    };
    (next as any)[session.mode === 'track' ? 'setsTrack' : 'setsTurning'] = next.sets;
    await persistSession(next);
    await updateStorageEstimate();
  }, [session, persistSession]);

  const updateSetTitle = useCallback(async (setKey: 'set1' | 'set2', title: string) => {
    if (!session) return;
    // Apply title
    let next: ApiPhotoSession = {
      ...session,
      version: session.version + 1,
      updatedAt: new Date().toISOString(),
      sets: { ...session.sets, [setKey]: { ...session.sets[setKey], title } },
    };

    // In turning point mode, sync the other set's title when pattern matches
    if (session.mode === 'turningpoint') {
      const otherKey = setKey === 'set1' ? 'set2' : 'set1';
      const spTpMatch = title.match(/^\s*SP\s*-\s*TP(\d+)\s*$/i); // SP - TPX
      const tpFpMatch = title.match(/^\s*TP(\d+)\s*-\s*FP\s*$/i); // TPX - FP
      if (spTpMatch) {
        const num = spTpMatch[1];
        next = {
          ...next,
          sets: {
            ...next.sets,
            [otherKey]: { ...next.sets[otherKey], title: `TP${num} - FP` }
          }
        };
      } else if (tpFpMatch) {
        const num = tpFpMatch[1];
        next = {
          ...next,
          sets: {
            ...next.sets,
            [otherKey]: { ...next.sets[otherKey], title: `SP - TP${num}` }
          }
        };
      }
    }

    // Mirror active sets into per-mode bucket
    (next as any)[session.mode === 'track' ? 'setsTrack' : 'setsTurning'] = next.sets;
    await persistSession(next);
    await updateStorageEstimate();
  }, [session, persistSession]);

  // Batch update multiple set titles atomically to avoid stale state overwrites
  const updateSetTitles = useCallback(async (titles: Partial<{ set1: string; set2: string }>) => {
    if (!session) return;
    const next: ApiPhotoSession = {
      ...session,
      version: session.version + 1,
      updatedAt: new Date().toISOString(),
      sets: {
        ...session.sets,
        set1: titles.set1 !== undefined ? { ...session.sets.set1, title: titles.set1 } : session.sets.set1,
        set2: titles.set2 !== undefined ? { ...session.sets.set2, title: titles.set2 } : session.sets.set2,
      },
    };
    (next as any)[session.mode === 'track' ? 'setsTrack' : 'setsTurning'] = next.sets;
    await persistSession(next);
    await updateStorageEstimate();
  }, [session, persistSession]);

  const reorderPhotos = useCallback(async (setKey: 'set1' | 'set2', fromIndex: number, toIndex: number) => {
    if (!session) return;
    const gridCapacity = ((session as any).layoutMode === 'portrait') ? 10 : 9;
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= gridCapacity || toIndex >= gridCapacity) return;
    const current = [...session.sets[setKey].photos];
    const slots: (ApiPhoto | null)[] = Array(gridCapacity).fill(null);
    current.forEach((p, i) => { if (i < gridCapacity) slots[i] = p; });
    const moving = slots[fromIndex];
    if (!moving) return;
    const compact = slots.filter((p, i) => p && i !== fromIndex) as ApiPhoto[];
    const insertIdx = fromIndex < toIndex ? Math.max(0, Math.min(compact.length, toIndex - 1)) : Math.max(0, Math.min(compact.length, toIndex));
    compact.splice(insertIdx, 0, moving);
    const next: ApiPhotoSession = {
      ...session,
      version: session.version + 1,
      updatedAt: new Date().toISOString(),
      sets: { ...session.sets, [setKey]: { ...session.sets[setKey], photos: compact.slice(0, gridCapacity) } },
    };
    (next as any)[session.mode === 'track' ? 'setsTrack' : 'setsTurning'] = next.sets;
    await persistSession(next);
    await updateStorageEstimate();
  }, [session, persistSession]);

  const shufflePhotos = useCallback(async (setKey: 'set1' | 'set2' | 'both') => {
    if (!session) return;
    const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
    const next: ApiPhotoSession = {
      ...session,
      version: session.version + 1,
      updatedAt: new Date().toISOString(),
      sets: {
        set1: (setKey === 'set1' || setKey === 'both') ? { ...session.sets.set1, photos: shuffle(session.sets.set1.photos) } : session.sets.set1,
        set2: (setKey === 'set2' || setKey === 'both') ? { ...session.sets.set2, photos: shuffle(session.sets.set2.photos) } : session.sets.set2,
      },
    };
    (next as any)[session.mode === 'track' ? 'setsTrack' : 'setsTurning'] = next.sets;
    await persistSession(next);
    await updateStorageEstimate();
  }, [session, persistSession]);

  const updateSessionMode = useCallback(async (mode: 'track' | 'turningpoint') => {
    if (!session) return;
    // Save current active sets into the current mode bucket
    const currentKey = session.mode === 'track' ? 'setsTrack' : 'setsTurning';
    const nextKey = mode === 'track' ? 'setsTrack' : 'setsTurning';
    const sAny: any = session as any;
    const next: any = { ...session };
    next[currentKey] = session.sets;
    // Load target mode sets (or empty)
    const target = sAny[nextKey] || { set1: { title: '', photos: [] }, set2: { title: '', photos: [] } };
    // Deep clone to avoid mutating stored buckets
    next.sets = {
      set1: { ...target.set1, photos: [...target.set1.photos] },
      set2: { ...target.set2, photos: [...target.set2.photos] },
    };
    // Ensure blob URLs exist for the newly active photos
    try {
      for (const p of next.sets.set1.photos) {
        if (!p.url) { p.url = await getPhotoURL(p.id); }
      }
      for (const p of next.sets.set2.photos) {
        if (!p.url) { p.url = await getPhotoURL(p.id); }
      }
    } catch (e) {
      // Non-fatal; UI will try to preload and surface errors if any
    }
    next.mode = mode;
    next.version = session.version + 1;
    next.updatedAt = new Date().toISOString();
    await persistSession(next as ApiPhotoSession);
    await updateStorageEstimate();
  }, [session, persistSession]);

  const updateLayoutMode = useCallback(async (layoutMode: LayoutMode) => {
    if (!session) return;
    const next: ApiPhotoSession = { ...(session as any), version: session.version + 1, updatedAt: new Date().toISOString(), layoutMode };
    await persistSession(next);
  }, [session, persistSession]);

  const updateCompetitionName = useCallback(async (competitionName: string) => {
    if (!session) return;
    const next: ApiPhotoSession = { ...session, version: session.version + 1, updatedAt: new Date().toISOString(), competition_name: competitionName };
    await persistSession(next);
  }, [session, persistSession]);

  const clearError = useCallback(() => setError(null), []);

  const getSessionStats = useCallback(() => {
    if (!session) return { set1Photos: 0, set2Photos: 0, totalPhotos: 0, set1Available: 9, set2Available: 9, isComplete: false };
    const gridCapacity = ((session as any).layoutMode === 'portrait') ? 10 : 9;
    const set1Count = session.sets.set1.photos.length;
    const set2Count = session.sets.set2.photos.length;
    return {
      set1Photos: set1Count,
      set2Photos: set2Count,
      totalPhotos: set1Count + set2Count,
      set1Available: Math.max(0, gridCapacity - Math.min(set1Count, gridCapacity)),
      set2Available: Math.max(0, gridCapacity - Math.min(set2Count, gridCapacity)),
      isComplete: Math.min(set1Count, gridCapacity) === gridCapacity && Math.min(set2Count, gridCapacity) === gridCapacity,
    };
  }, [session]);

  return {
    session,
    sessionId,
    loading,
    error,
    backendAvailable: opfsAvailable, // reused field for banner logic
    addPhotosToSet,
    addPhotosToTurningPoint: async (files: File[]) => {
      if (!session) return;
      const gridCapacity = ((session as any).layoutMode === 'portrait') ? 10 : 9;
      const maxTotal = gridCapacity * 2;
      const set1Count = session.sets.set1.photos.length;
      const set2Count = session.sets.set2.photos.length;
      const total = set1Count + set2Count;
      if (total + files.length > maxTotal) {
        setError(`Cannot add ${files.length} photos. Maximum ${maxTotal} photos allowed (${total} already added).`);
        return;
      }
      const filesToSet1: File[] = [];
      const filesToSet2: File[] = [];
      for (const f of files) { const currentSet1 = set1Count + filesToSet1.length; if (currentSet1 < gridCapacity) filesToSet1.push(f); else filesToSet2.push(f); }
      if (filesToSet1.length) await addPhotosToSet(filesToSet1, 'set1');
      if (filesToSet2.length) await addPhotosToSet(filesToSet2, 'set2');
    },
    removePhoto,
    updatePhotoState,
    updateSetTitle,
    updateSetTitles,
    reorderPhotos,
    shufflePhotos,
    updateSessionMode,
    updateLayoutMode,
    updateCompetitionName,
    resetSession: async () => {
      // Clear persistent data as well
      try {
        if (handlesRef.current.sessionsDir && session?.id) {
          // Delete the entire session folder (including photos)
          const { deleteSessionDir } = await import('../services/opfsService');
          await deleteSessionDir(handlesRef.current.sessionsDir, session.id);
          // Recreate empty dirs
          const { dir, photos } = await ensureSessionDirs({ root: {} as any, sessions: handlesRef.current.sessionsDir }, session.id);
          handlesRef.current.sessionDir = dir;
          handlesRef.current.photosDir = photos;
        }
      } catch (e) {
        console.warn('Failed to delete session dir, proceeding with in-memory reset', e);
      }
      const id = session?.id || loadOrCreateSessionId();
      const fresh = defaultSession(id);
      // Initialize TRACK titles on reset
      const trackTitles = getTrackTitles();
      (fresh as any).sets = {
        set1: { title: trackTitles.set1, photos: [] },
        set2: { title: trackTitles.set2, photos: [] },
      };
      (fresh as any).setsTrack = (fresh as any).sets;
      (fresh as any).setsTurning = { set1: { title: '', photos: [] }, set2: { title: '', photos: [] } };
      await persistSession(fresh);
      setError(null);
      // Revoke all URLs
      for (const url of objectURLsRef.current.values()) URL.revokeObjectURL(url);
      objectURLsRef.current.clear();
      await updateStorageEstimate();
    },
    refreshSession: async () => {
      // Reload session.json from disk and rebuild blob URLs
      try {
        if (handlesRef.current.sessionDir) {
          const existing = await readJSON<ApiPhotoSession>(handlesRef.current.sessionDir, 'session.json');
          if (existing) {
            const withUrls: ApiPhotoSession = {
              ...existing,
              sets: {
                set1: { ...existing.sets.set1, photos: [...existing.sets.set1.photos] },
                set2: { ...existing.sets.set2, photos: [...existing.sets.set2.photos] },
              },
            };
            for (const p of withUrls.sets.set1.photos) {
              try { p.url = await getPhotoURL(p.id); } catch { p.url = ''; }
            }
            for (const p of withUrls.sets.set2.photos) {
              try { p.url = await getPhotoURL(p.id); } catch { p.url = ''; }
            }
            setSession(withUrls);
          }
        }
      } catch (e) {
        console.warn('Failed to refresh session from OPFS', e);
      }
    },
    clearError,
    checkBackendHealth: async () => {},
    getSessionStats,
    // storage
    storageQuotaBytes,
    storageUsedBytes,
    storagePercentFree,
    isStorageLow,
    updateStorageEstimate,
  };
}


