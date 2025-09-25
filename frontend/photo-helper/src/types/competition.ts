/**
 * Competition versioning system type definitions
 */

import type { ApiPhotoSession } from './api';

export interface Competition {
  id: string;
  name: string;                    // Competition name or fallback like "Competition 1"
  createdAt: string;              // ISO date string
  lastModified: string;           // ISO date string  
  photoCount: number;             // Total photos across all sets
  session: ApiPhotoSession;       // Complete session data
}

export interface CompetitionMetadata {
  id: string;
  name: string;
  createdAt: string;
  lastModified: string;
  photoCount: number;
  isActive: boolean;              // Currently selected competition
}

export interface CompetitionsIndex {
  competitions: CompetitionMetadata[];
  activeCompetitionId: string | null;
  version: number;                // For future migrations
}

export interface CleanupCandidate {
  competition: CompetitionMetadata;
  reason: 'age' | 'excess';
  daysOld?: number;
  estimatedSizeMB?: number;
}

export interface CleanupSuggestion {
  candidates: CleanupCandidate[];
  totalStorageToFree: string;     // "~25MB"
  currentCompetitionCount: number;
  wouldKeepCompetitions: number;
}

export interface StorageStats {
  usedBytes: number | null;
  quotaBytes: number | null;
  percentUsed: number | null;
  isLow: boolean;                 // >80% used
  isCritical: boolean;            // >95% used
}

export type CleanupAction = 'confirm' | 'decline' | 'postpone';
