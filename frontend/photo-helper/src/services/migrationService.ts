/**
 * Migration service to convert existing OPFS sessions to competition format
 */

import type { ApiPhotoSession } from '../types/api';
import type { Competition } from '../types/competition';
import { competitionService } from './competitionService';
import { 
  initOPFS, 
  readJSON, 
  ensureSessionDirs, 
  loadOrCreateSessionId,
  deleteSessionDir 
} from './opfsService';

export interface MigrationResult {
  migrated: boolean;
  competition?: Competition;
  message: string;
}

export class MigrationService {
  
  /**
   * Check if migration is needed and perform it
   */
  async performMigration(getDefaultCompetitionName: () => string): Promise<MigrationResult> {
    try {
      // Check if competitions already exist
      const index = await competitionService.getCompetitionsIndex();
      if (index.competitions.length > 0) {
        return {
          migrated: false,
          message: 'Competitions already exist, no migration needed'
        };
      }

      // Look for existing session in old format
      const existingSession = await this.findExistingSession();
      
      if (!existingSession) {
        return {
          migrated: false,
          message: 'No existing session found to migrate'
        };
      }

      // Create first competition from existing session
      const defaultName = getDefaultCompetitionName();
      
      // Prepare session with proper mode-specific sets for migration
      const migratedSession = this.prepareMigratedSession(existingSession);
      
      const competition = await competitionService.createCompetition(defaultName, migratedSession);
      
      // Clean up old session directory
      await this.cleanupOldSession();
      
      return {
        migrated: true,
        competition,
        message: `Successfully migrated existing session to "${defaultName}"`
      };
      
    } catch (error) {
      console.error('Migration failed:', error);
      return {
        migrated: false,
        message: `Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Prepare migrated session with proper mode-specific sets structure
   */
  private prepareMigratedSession(existingSession: ApiPhotoSession): ApiPhotoSession {
    // Deep clone to avoid mutating the original
    const session = JSON.parse(JSON.stringify(existingSession));
    
    // Initialize mode-specific storage
    // Helpers to avoid shared references across buckets
    const makeEmptySet = () => ({ title: '', photos: [] });
    
    // Check if session already has mode-specific sets (from newer OPFS format)
    const hasExistingModeStorage = (session as any).setsTrack || (session as any).setsTurning;
    
    if (hasExistingModeStorage) {
      // Session already has mode-specific storage, preserve it
      session.setsTrack = (session as any).setsTrack || { set1: makeEmptySet(), set2: makeEmptySet() };
      session.setsTurning = (session as any).setsTurning || { set1: makeEmptySet(), set2: makeEmptySet() };
    } else {
      // Legacy session without mode-specific storage
      // Initialize mode-specific storage based on current mode
      if (session.mode === 'track') {
        // Current sets belong to track mode
        // Deep clone to avoid shared references
        const clonedSet1 = JSON.parse(JSON.stringify(session.sets.set1));
        const clonedSet2 = JSON.parse(JSON.stringify(session.sets.set2));
        session.setsTrack = { set1: clonedSet1, set2: clonedSet2 };
        session.setsTurning = { set1: makeEmptySet(), set2: makeEmptySet() };
        
        // Ensure track mode has proper default titles
        if (!session.setsTrack.set1.title || session.setsTrack.set1.title.trim() === '') {
          session.setsTrack.set1.title = 'SP - TPX';
          session.sets.set1.title = 'SP - TPX'; // Update active sets too
        }
        if (!session.setsTrack.set2.title || session.setsTrack.set2.title.trim() === '') {
          session.setsTrack.set2.title = 'TPX - FP';
          session.sets.set2.title = 'TPX - FP'; // Update active sets too
        }
      } else {
        // Current sets belong to turning point mode
        // Deep clone to avoid shared references
        const clonedSet1 = JSON.parse(JSON.stringify(session.sets.set1));
        const clonedSet2 = JSON.parse(JSON.stringify(session.sets.set2));
        session.setsTurning = { set1: clonedSet1, set2: clonedSet2 };
        session.setsTrack = { 
          set1: { title: 'SP - TPX', photos: [] }, 
          set2: { title: 'TPX - FP', photos: [] } 
        };
      }
    }
    
    return session;
  }

  /**
   * Find existing session in old OPFS format
   */
  private async findExistingSession(): Promise<ApiPhotoSession | null> {
    try {
      const handles = await initOPFS();
      const sessionId = loadOrCreateSessionId();
      
      // Try to read from old sessions directory structure
      const { dir } = await ensureSessionDirs(handles, sessionId);
      const session = await readJSON<ApiPhotoSession>(dir, 'session.json');
      
      if (!session) {
        return null;
      }

      // Validate session has meaningful data
      const hasPhotos = (
        session.sets.set1.photos.length > 0 || 
        session.sets.set2.photos.length > 0
      );
      
      const hasCustomName = (
        session.competition_name && 
        session.competition_name.trim() !== ''
      );

      // Only migrate if session has photos or custom competition name
      if (hasPhotos || hasCustomName) {
        return session;
      }

      return null;
      
    } catch (error) {
      console.warn('Could not find existing session:', error);
      return null;
    }
  }

  /**
   * Clean up old session directory after successful migration
   */
  private async cleanupOldSession(): Promise<void> {
    try {
      const handles = await initOPFS();
      const sessionId = loadOrCreateSessionId();
      
      // Delete the old session directory
      await deleteSessionDir(handles.sessions, sessionId);
      
      console.log('Old session directory cleaned up successfully');
      
    } catch (error) {
      console.warn('Could not clean up old session directory:', error);
      // Non-fatal error, migration was successful
    }
  }

  /**
   * Check if the app is running in legacy mode (needs migration)
   */
  async needsMigration(): Promise<boolean> {
    try {
      const index = await competitionService.getCompetitionsIndex();
      return index.competitions.length === 0;
    } catch {
      return true; // If we can't read index, assume migration needed
    }
  }
}

// Singleton instance
export const migrationService = new MigrationService();
