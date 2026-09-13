// Re-exported, never redeclared. `@airq/shared-discipline` is the single
// source of truth for this type and its allowlist — that package exists
// precisely to stop a second copy drifting out of sync.
export type { Discipline } from '@airq/shared-discipline';
import type { Discipline } from '@airq/shared-discipline';

export interface CompetitionMetadata {
  id: string;
  name: string;
  discipline?: Discipline;
  createdAt: string;
  lastModified: string;
  photoCount: number;
  isActive: boolean;
}

export interface CompetitionsIndex {
  competitions: CompetitionMetadata[];
  activeCompetitionId: string | null;
  version: number;
}

export interface Competition<TSession = unknown> {
  id: string;
  name: string;
  discipline?: Discipline;
  createdAt: string;
  lastModified: string;
  photoCount: number;
  session: TSession;
}

export type CleanupReason = 'age' | 'excess';

export interface CleanupCandidate {
  competition: CompetitionMetadata;
  reason: CleanupReason;
  daysOld?: number;
  estimatedSizeMB?: number;
}

export interface CleanupSuggestion {
  candidates: CleanupCandidate[];
  totalStorageToFree: string;
  currentCompetitionCount: number;
  wouldKeepCompetitions: number;
}

export interface StorageStats {
  usedBytes: number | null;
  quotaBytes: number | null;
  percentUsed: number | null;
  isLow: boolean;
  isCritical: boolean;
}

export type CleanupAction = 'confirm' | 'decline' | 'postpone';
