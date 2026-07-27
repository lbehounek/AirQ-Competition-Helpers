import type { PhotoSession, PhotoSet, Photo } from '../types';
import { generatePhotoLabels } from './imageProcessing';

/**
 * Generate a unique session ID
 */
export const generateSessionId = (): string => {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Create a new empty photo session
 */
export const createNewSession = (): PhotoSession => {
  const sessionId = generateSessionId();
  const now = new Date();
  
  return {
    id: sessionId,
    version: 1,
    createdAt: now,
    updatedAt: now,
    mode: 'track', // Default mode
    layoutMode: 'landscape', // Default to landscape layout
    competition_name: '', // Empty competition name
    sets: {
      set1: createEmptyPhotoSet(),
      set2: createEmptyPhotoSet()
    }
  };
};

/**
 * Create an empty photo set
 */
export const createEmptyPhotoSet = (): PhotoSet => {
  return {
    title: '',
    photos: []
  };
};

/**
 * Create a new photo object from file
 */
// `_setIndex` is unused: labels restart at 'A' in each set, so only the
// within-set index selects the label. It stays in the signature (and keeps its
// position) because every call site passes it.
export const createPhotoFromFile = (file: File, _setIndex: number, photoIndex: number): Photo => {
  const labels = generatePhotoLabels();

  return {
    id: `photo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    file,
    canvasState: {
      position: { x: 0, y: 0 },
      scale: 1.0, // 100% scale - fills canvas without white borders
      brightness: 0,
      contrast: 1,
      sharpness: 0,
      whiteBalance: {
        temperature: 0,
        tint: 0,
        auto: false,
      },
      labelPosition: 'bottom-left' as const,
    },
    label: labels[photoIndex] || 'X' // A-I for each set
  };
};

/**
 * Update session timestamp and version
 */
export const updateSessionVersion = (session: PhotoSession): PhotoSession => {
  return {
    ...session,
    version: session.version + 1,
    updatedAt: new Date()
  };
};

/**
 * Check if session has any photos
 */
export const hasPhotos = (session: PhotoSession): boolean => {
  return session.sets.set1.photos.length > 0 || session.sets.set2.photos.length > 0;
};

/**
 * Get total photo count in session
 */
export const getTotalPhotoCount = (session: PhotoSession): number => {
  return session.sets.set1.photos.length + session.sets.set2.photos.length;
};

/**
 * Validate session data
 */
export const validateSession = (session: any): session is PhotoSession => {
  return (
    session &&
    typeof session.id === 'string' &&
    typeof session.version === 'number' &&
    session.sets &&
    session.sets.set1 &&
    session.sets.set2 &&
    Array.isArray(session.sets.set1.photos) &&
    Array.isArray(session.sets.set2.photos)
  );
};

/**
 * Migrate session to latest version
 */
export const migrateSession = (session: Partial<PhotoSession>): PhotoSession => {
  const now = new Date();
  return {
    id: session.id ?? generateSessionId(),
    version: (typeof session.version === 'number' ? session.version : 1),
    createdAt: session.createdAt ?? now,
    updatedAt: session.updatedAt ?? now,
    mode: session.mode ?? 'track',
    layoutMode: session.layoutMode ?? 'landscape',
    competition_name: session.competition_name ?? '',
    sets: {
      set1: session.sets?.set1 ?? createEmptyPhotoSet(),
      set2: session.sets?.set2 ?? createEmptyPhotoSet()
    }
  };
};

/**
 * Local storage key generation
 */
export const getSessionStorageKey = (sessionId: string): string => {
  return `photo-organizer-session-${sessionId}`;
};

/**
 * Get all session IDs from localStorage
 */
export const getAllSessionIds = (): string[] => {
  const keys = Object.keys(localStorage);
  return keys
    .filter(key => key.startsWith('photo-organizer-session-'))
    .map(key => key.replace('photo-organizer-session-', ''))
    .sort((a, b) => b.localeCompare(a)); // Most recent first
};

/**
 * Clean up old sessions (keep only last 5)
 */
export const cleanupOldSessions = (): void => {
  const sessionIds = getAllSessionIds();
  
  // Keep only the 5 most recent sessions
  const sessionsToDelete = sessionIds.slice(5);
  
  sessionsToDelete.forEach(sessionId => {
    localStorage.removeItem(getSessionStorageKey(sessionId));
  });
  
  console.log(`Cleaned up ${sessionsToDelete.length} old sessions`);
};
