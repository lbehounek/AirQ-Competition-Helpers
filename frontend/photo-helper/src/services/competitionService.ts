/**
 * Competition versioning service for storage
 * Manages multiple competitions with photo isolation
 * Works with both OPFS (web) and native filesystem (Electron)
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
  initStorage,
  getStorage,
  type StorageInterface,
  type DirectoryHandle,
  type StorageHandles,
} from './storage';

const COMPETITIONS_INDEX_FILE = 'competitions-index.json';
const MAX_COMPETITIONS = 10;
const MAX_AGE_DAYS = 30;

export class CompetitionService {
  private storage: StorageInterface | null = null;
  private handles: StorageHandles | null = null;
  private competitionsDir: DirectoryHandle | null = null;

  async initialize(): Promise<void> {
    this.storage = await initStorage();
    this.handles = await this.storage.init();
    this.competitionsDir = await this.storage.getDirectoryHandle(
      this.handles.root,
      'competitions',
      { create: true }
    );
  }

  async ensureInitialized(): Promise<void> {
    if (!this.storage || !this.handles || !this.competitionsDir) {
      await this.initialize();
    }
  }

  // Competition Index Management
  async getCompetitionsIndex(): Promise<CompetitionsIndex> {
    await this.ensureInitialized();
    const existing = await this.storage!.readJSON<CompetitionsIndex>(
      this.handles!.root,
      COMPETITIONS_INDEX_FILE
    );

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
    await this.storage!.writeJSON(this.handles!.root, COMPETITIONS_INDEX_FILE, index);
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
    const competitionDir = await this.storage!.getDirectoryHandle(
      this.competitionsDir!,
      id,
      { create: true }
    );
    const photosDir = await this.storage!.getDirectoryHandle(
      competitionDir,
      'photos',
      { create: true }
    );

    await this.storage!.writeJSON(competitionDir, 'session.json', competition.session);

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
      const competitionDir = await this.storage!.getDirectoryHandle(
        this.competitionsDir!,
        id,
        { create: false }
      );
      const session = await this.storage!.readJSON<ApiPhotoSession>(competitionDir, 'session.json');

      if (!session) {
        return null;
      }

      const index = await this.getCompetitionsIndex();
      const metadata = index.competitions.find(c => c.id === id);

      if (!metadata) {
        return null;
      }

      // Load photos with blob URLs
      const photosDir = await this.storage!.getDirectoryHandle(
        competitionDir,
        'photos',
        { create: false }
      );
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

    const competitionDir = await this.storage!.getDirectoryHandle(
      this.competitionsDir!,
      competition.id,
      { create: false }
    );
    const photosDir = await this.storage!.getDirectoryHandle(
      competitionDir,
      'photos',
      { create: true }
    );

    // Update session data
    const sanitizedSession = this.sanitizeSessionForStorage(competition.session);
    await this.storage!.writeJSON(competitionDir, 'session.json', sanitizedSession);

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
      // Delete competition directory by clearing it and then removing
      const competitionDir = await this.storage!.getDirectoryHandle(
        this.competitionsDir!,
        id,
        { create: false }
      );

      // Clear the directory contents first
      await this.storage!.clearDirectory(competitionDir);

      // Note: For OPFS, we need to use a different approach
      // The storage abstraction handles directory deletion
      // For now, we'll use the parent to remove the entry
      try {
        // Try to get competitions directory entries and remove
        const entries = await this.storage!.listDirectory(this.competitionsDir!);
        if (entries.find(e => e.name === id && e.isDirectory)) {
          // Use a workaround: re-get the directory and clear it
          // The directory should be empty now, attempting removal
          // For OPFS this requires removeEntry on parent
          // For Electron this is handled by the IPC

          // This is a limitation of the abstraction - we need direct parent access
          // For now, just ensure it's empty which effectively "deletes" it
        }
      } catch {
        // Ignore errors during cleanup
      }

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
      await this.ensureInitialized();
      const estimate = await this.storage!.getStorageEstimate();
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
      await this.ensureInitialized();
      const competitionDir = await this.storage!.getDirectoryHandle(
        this.competitionsDir!,
        competitionId,
        { create: false }
      );
      const photosDir = await this.storage!.getDirectoryHandle(
        competitionDir,
        'photos',
        { create: false }
      );

      let totalSize = 0;

      // Estimate session.json size (usually small)
      totalSize += 0.01; // ~10KB for session metadata

      // Estimate photos size by counting entries
      const entries = await this.storage!.listDirectory(photosDir);
      const photoCount = entries.filter(e => !e.isDirectory).length;
      totalSize += photoCount * 2; // ~2MB per photo estimate

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
    const clearUrls = (sets?: { set1: any; set2: any }) => {
      if (!sets) return undefined;
      return {
        set1: {
          ...sets.set1,
          photos: (sets.set1?.photos || []).map((p: any) => ({ ...p, url: '' }))
        },
        set2: {
          ...sets.set2,
          photos: (sets.set2?.photos || []).map((p: any) => ({ ...p, url: '' }))
        }
      };
    };

    return {
      ...session,
      sets: clearUrls(session.sets) as any,
      ...(session as any).setsTrack ? { setsTrack: clearUrls((session as any).setsTrack) as any } : {},
      ...(session as any).setsTurning ? { setsTurning: clearUrls((session as any).setsTurning) as any } : {}
    };
  }

  private async saveSessionPhotos(session: ApiPhotoSession, photosDir: DirectoryHandle): Promise<void> {
    await this.ensureInitialized();

    // Storage strategy: do NOT clear directory to avoid removing photos
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
          await this.storage!.savePhotoFile(photosDir, photo.id, file);
        } catch (error) {
          console.warn(`Failed to save photo ${photo.id}:`, error);
        }
      }
    }
  }

  private async loadSessionPhotos(session: ApiPhotoSession, photosDir: DirectoryHandle): Promise<ApiPhotoSession> {
    await this.ensureInitialized();

    const loadPhotoUrls = async (photos: typeof session.sets.set1.photos) => {
      const updatedPhotos = [];
      for (const photo of photos) {
        try {
          const blob = await this.storage!.getPhotoBlob(photosDir, photo.id);
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
