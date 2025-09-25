/**
 * Competition versioning service for OPFS storage
 * Manages multiple competitions with photo isolation
 */

import type { 
  Competition, 
  CompetitionMetadata, 
  CompetitionsIndex,
  CleanupCandidate,
  StorageStats 
} from '../types/competition';
import type { ApiPhotoSession } from '../types/api';
import {
  initOPFS,
  writeJSON,
  readJSON,
  savePhotoFile,
  getPhotoBlob,
  deletePhotoFile,
  deleteSessionDir,
  clearDirectory,
  type OPFSHandles
} from './opfsService';

const COMPETITIONS_INDEX_FILE = 'competitions-index.json';
const MAX_COMPETITIONS = 10;
const MAX_AGE_DAYS = 30;

export class CompetitionService {
  private handles: OPFSHandles | null = null;
  private competitionsDir: FileSystemDirectoryHandle | null = null;

  async initialize(): Promise<void> {
    this.handles = await initOPFS();
    this.competitionsDir = await this.handles.root.getDirectoryHandle('competitions', { create: true });
  }

  async ensureInitialized(): Promise<void> {
    if (!this.handles || !this.competitionsDir) {
      await this.initialize();
    }
  }

  // Competition Index Management
  async getCompetitionsIndex(): Promise<CompetitionsIndex> {
    await this.ensureInitialized();
    const existing = await readJSON<CompetitionsIndex>(this.handles!.root, COMPETITIONS_INDEX_FILE);
    
    if (existing) {
      return existing;
    }

    // Create empty index
    const newIndex: CompetitionsIndex = {
      competitions: [],
      activeCompetitionId: null,
      version: 1
    };
    
    await this.saveCompetitionsIndex(newIndex);
    return newIndex;
  }

  async saveCompetitionsIndex(index: CompetitionsIndex): Promise<void> {
    await this.ensureInitialized();
    await writeJSON(this.handles!.root, COMPETITIONS_INDEX_FILE, index);
  }

  // Competition CRUD Operations
  async createCompetition(name: string, session: ApiPhotoSession): Promise<Competition> {
    await this.ensureInitialized();
    
    const id = `comp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    
    const competition: Competition = {
      id,
      name,
      createdAt: now,
      lastModified: now,
      photoCount: this.calculatePhotoCount(session),
      session: this.sanitizeSessionForStorage(session)
    };

    // Create competition directory and save session
    const competitionDir = await this.competitionsDir!.getDirectoryHandle(id, { create: true });
    const photosDir = await competitionDir.getDirectoryHandle('photos', { create: true });
    
    await writeJSON(competitionDir, 'session.json', competition.session);

    // Save photos to competition directory
    await this.saveSessionPhotos(session, photosDir);

    // Update index
    const index = await this.getCompetitionsIndex();
    const metadata: CompetitionMetadata = {
      id: competition.id,
      name: competition.name,
      createdAt: competition.createdAt,
      lastModified: competition.lastModified,
      photoCount: competition.photoCount,
      isActive: true // New competition becomes active
    };

    // Set all others to inactive
    index.competitions.forEach(comp => comp.isActive = false);
    index.competitions.push(metadata);
    index.activeCompetitionId = id;

    await this.saveCompetitionsIndex(index);
    return competition;
  }

  async getCompetition(id: string): Promise<Competition | null> {
    await this.ensureInitialized();
    
    try {
      const competitionDir = await this.competitionsDir!.getDirectoryHandle(id, { create: false });
      const session = await readJSON<ApiPhotoSession>(competitionDir, 'session.json');
      
      if (!session) {
        return null;
      }

      const index = await this.getCompetitionsIndex();
      const metadata = index.competitions.find(c => c.id === id);
      
      if (!metadata) {
        return null;
      }

      // Load photos with blob URLs
      const photosDir = await competitionDir.getDirectoryHandle('photos', { create: false });
      const sessionWithUrls = await this.loadSessionPhotos(session, photosDir);

      return {
        id,
        name: metadata.name,
        createdAt: metadata.createdAt,
        lastModified: metadata.lastModified,
        photoCount: metadata.photoCount,
        session: sessionWithUrls
      };
    } catch {
      return null;
    }
  }

  async updateCompetition(competition: Competition, options?: { updatePhotos?: boolean }): Promise<void> {
    await this.ensureInitialized();
    
    const competitionDir = await this.competitionsDir!.getDirectoryHandle(competition.id, { create: false });
    const photosDir = await competitionDir.getDirectoryHandle('photos', { create: true });
    
    // Update session data
    const sanitizedSession = this.sanitizeSessionForStorage(competition.session);
    await writeJSON(competitionDir, 'session.json', sanitizedSession);
    
    // Only update photos if explicitly requested (e.g., when photos actually changed)
    if (options?.updatePhotos) {
      await this.saveSessionPhotos(competition.session, photosDir);
    }
    
    // Update metadata in index
    const index = await this.getCompetitionsIndex();
    const metadataIndex = index.competitions.findIndex(c => c.id === competition.id);
    
    if (metadataIndex >= 0) {
      index.competitions[metadataIndex] = {
        ...index.competitions[metadataIndex],
        name: competition.name,
        lastModified: new Date().toISOString(),
        photoCount: this.calculatePhotoCount(competition.session)
      };
      
      await this.saveCompetitionsIndex(index);
    }
  }

  async deleteCompetition(id: string): Promise<void> {
    await this.ensureInitialized();
    
    try {
      // Delete competition directory
      await this.competitionsDir!.removeEntry(id, { recursive: true });
      
      // Update index
      const index = await this.getCompetitionsIndex();
      index.competitions = index.competitions.filter(c => c.id !== id);
      
      // If this was the active competition, set another as active
      if (index.activeCompetitionId === id) {
        index.activeCompetitionId = index.competitions.length > 0 ? index.competitions[0].id : null;
        if (index.competitions.length > 0) {
          index.competitions[0].isActive = true;
        }
      }
      
      await this.saveCompetitionsIndex(index);
    } catch (error) {
      console.error('Failed to delete competition:', error);
      throw new Error(`Failed to delete competition: ${id}`);
    }
  }

  async setActiveCompetition(id: string): Promise<void> {
    const index = await this.getCompetitionsIndex();
    
    // Set all to inactive
    index.competitions.forEach(comp => comp.isActive = false);
    
    // Set target as active
    const target = index.competitions.find(c => c.id === id);
    if (target) {
      target.isActive = true;
      index.activeCompetitionId = id;
      await this.saveCompetitionsIndex(index);
    } else {
      throw new Error(`Competition not found: ${id}`);
    }
  }

  async getActiveCompetition(): Promise<Competition | null> {
    const index = await this.getCompetitionsIndex();
    
    if (!index.activeCompetitionId) {
      return null;
    }
    
    return this.getCompetition(index.activeCompetitionId);
  }

  // Cleanup Detection
  async detectCleanupCandidates(): Promise<CleanupCandidate[]> {
    const index = await this.getCompetitionsIndex();
    const candidates: CleanupCandidate[] = [];
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
    
    // Check for age-based candidates
    for (const comp of index.competitions) {
      const createdAt = new Date(comp.createdAt);
      if (createdAt < thirtyDaysAgo) {
        const estimatedSize = await this.estimateCompetitionSize(comp.id);
        candidates.push({
          competition: comp,
          reason: 'age',
          daysOld: Math.floor((now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000)),
          estimatedSizeMB: estimatedSize
        });
      }
    }
    
    // Check for excess candidates (>10 competitions)
    if (index.competitions.length > MAX_COMPETITIONS) {
      const sorted = [...index.competitions].sort((a, b) => 
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      
      const excessCount = index.competitions.length - MAX_COMPETITIONS;
      const excessCompetitions = sorted.slice(0, excessCount);
      
      for (const comp of excessCompetitions) {
        // Don't double-add if already in age candidates
        if (!candidates.find(c => c.competition.id === comp.id)) {
          const estimatedSize = await this.estimateCompetitionSize(comp.id);
          candidates.push({
            competition: comp,
            reason: 'excess',
            estimatedSizeMB: estimatedSize
          });
        }
      }
    }
    
    return candidates;
  }

  async performCleanup(candidates: CleanupCandidate[]): Promise<void> {
    for (const candidate of candidates) {
      await this.deleteCompetition(candidate.competition.id);
    }
  }

  // Migration from existing session
  async migrateExistingSession(session: ApiPhotoSession, defaultName: string): Promise<Competition> {
    // Create first competition from existing session
    return this.createCompetition(defaultName, session);
  }

  // Storage monitoring
  async getStorageStats(): Promise<StorageStats> {
    try {
      const estimate = await (navigator as any).storage?.estimate?.();
      const usage = estimate?.usage || null;
      const quota = estimate?.quota || null;
      
      let percentUsed = null;
      let isLow = false;
      let isCritical = false;
      
      if (usage !== null && quota !== null && quota > 0) {
        percentUsed = Math.round((usage / quota) * 100);
        isLow = percentUsed >= 80;
        isCritical = percentUsed >= 95;
      }
      
      return {
        usedBytes: usage,
        quotaBytes: quota,
        percentUsed,
        isLow,
        isCritical
      };
    } catch {
      return {
        usedBytes: null,
        quotaBytes: null,
        percentUsed: null,
        isLow: false,
        isCritical: false
      };
    }
  }

  // Estimate competition size
  private async estimateCompetitionSize(competitionId: string): Promise<number> {
    try {
      const competitionDir = await this.competitionsDir!.getDirectoryHandle(competitionId, { create: false });
      const photosDir = await competitionDir.getDirectoryHandle('photos', { create: false });
      
      let totalSize = 0;
      
      // Estimate session.json size (usually small)
      totalSize += 0.01; // ~10KB for session metadata
      
      // Estimate photos size
      const anyPhotosDir: any = photosDir as any;
      if (anyPhotosDir?.entries) {
        for await (const [name, handle] of anyPhotosDir.entries()) {
          if ((handle as any)?.kind === 'file') {
            try {
              const file = await (handle as any).getFile();
              totalSize += file.size / 1024 / 1024; // Convert to MB
            } catch {
              // Estimate average photo size if we can't read it
              totalSize += 2; // ~2MB per photo estimate
            }
          }
        }
      }
      
      return Math.round(totalSize * 10) / 10; // Round to 1 decimal
    } catch {
      // Fallback estimation based on photo count
      const index = await this.getCompetitionsIndex();
      const comp = index.competitions.find(c => c.id === competitionId);
      return comp ? comp.photoCount * 2 : 0; // 2MB per photo estimate
    }
  }

  // Utility methods
  private calculatePhotoCount(session: ApiPhotoSession): number {
    return session.sets.set1.photos.length + session.sets.set2.photos.length;
  }

  private sanitizeSessionForStorage(session: ApiPhotoSession): ApiPhotoSession {
    return {
      ...session,
      sets: {
        set1: {
          ...session.sets.set1,
          photos: session.sets.set1.photos.map(p => ({ ...p, url: '' }))
        },
        set2: {
          ...session.sets.set2,
          photos: session.sets.set2.photos.map(p => ({ ...p, url: '' }))
        }
      }
    };
  }

  private async saveSessionPhotos(session: ApiPhotoSession, photosDir: FileSystemDirectoryHandle): Promise<void> {
    // OPFS-only strategy: do NOT clear directory to avoid removing photos
    // from the non-active mode bucket. Persist any photos that have fresh
    // blob URLs; previously saved files remain available for loading.

    // Collect photos across active sets and both mode buckets
    const collect = (sets?: { set1: any; set2: any }) =>
      sets ? [...(sets.set1?.photos || []), ...(sets.set2?.photos || [])] : [];

    const activePhotos = collect(session.sets as any);
    const trackPhotos = collect((session as any).setsTrack);
    const turningPhotos = collect((session as any).setsTurning);

    // Deduplicate by id while preserving first occurrence with a blob url if available
    const idToPhoto = new Map<string, any>();
    const pushPhoto = (p: any) => {
      if (!p || !p.id) return;
      if (!idToPhoto.has(p.id)) {
        idToPhoto.set(p.id, p);
      } else {
        const existing = idToPhoto.get(p.id);
        if ((!existing.url || !existing.url.startsWith('blob:')) && p.url && p.url.startsWith('blob:')) {
          idToPhoto.set(p.id, p);
        }
      }
    };

    [...activePhotos, ...trackPhotos, ...turningPhotos].forEach(pushPhoto);

    for (const photo of idToPhoto.values()) {
      if (photo.url && photo.url.startsWith('blob:')) {
        try {
          const response = await fetch(photo.url);
          const blob = await response.blob();
          const file = new File([blob], photo.filename, { type: blob.type });
          await savePhotoFile(photosDir, photo.id, file);
        } catch (error) {
          console.warn(`Failed to save photo ${photo.id}:`, error);
        }
      }
    }
  }

  private async loadSessionPhotos(session: ApiPhotoSession, photosDir: FileSystemDirectoryHandle): Promise<ApiPhotoSession> {
    const loadPhotoUrls = async (photos: typeof session.sets.set1.photos) => {
      const updatedPhotos = [];
      for (const photo of photos) {
        try {
          const blob = await getPhotoBlob(photosDir, photo.id);
          const url = URL.createObjectURL(blob);
          updatedPhotos.push({ ...photo, url });
        } catch {
          // Photo file not found, keep without URL
          updatedPhotos.push({ ...photo, url: '' });
        }
      }
      return updatedPhotos;
    };

    // Load blob URLs for mode-specific sets as well
    const loadModeSpecificSets = async (sets: { set1: any; set2: any } | undefined) => {
      if (!sets) return undefined;
      return {
        set1: {
          ...sets.set1,
          photos: await loadPhotoUrls(sets.set1.photos || [])
        },
        set2: {
          ...sets.set2,
          photos: await loadPhotoUrls(sets.set2.photos || [])
        }
      };
    };

    return {
      ...session,
      sets: {
        set1: {
          ...session.sets.set1,
          photos: await loadPhotoUrls(session.sets.set1.photos)
        },
        set2: {
          ...session.sets.set2,
          photos: await loadPhotoUrls(session.sets.set2.photos)
        }
      },
      setsTrack: await loadModeSpecificSets(session.setsTrack),
      setsTurning: await loadModeSpecificSets(session.setsTurning)
    };
  }
}

// Singleton instance
export const competitionService = new CompetitionService();
