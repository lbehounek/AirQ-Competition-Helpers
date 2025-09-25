# Competition Versioning System

## Overview

This implementation adds a competition-based versioning system to the photo-helper app, allowing users to manage multiple independent photo sessions with automatic cleanup and storage management.

## Key Features

✅ **Competition-based Sessions**: Each competition maintains its own photos and settings  
✅ **Explicit Creation**: Users manually create new competitions via UI button  
✅ **Auto-migration**: Existing sessions automatically become "Competition 1"  
✅ **Smart Cleanup**: Automatic suggestions for competitions >30 days old or >10 total  
✅ **Storage Monitoring**: Real-time storage usage warnings and limits  
✅ **I18n Support**: Multi-language competition names (EN: Competition, CS: Soutěž)  
✅ **Name Synchronization**: Competition names auto-update when session comp name changes  

## Architecture

### Core Components

```
src/
├── types/competition.ts          # Type definitions
├── services/
│   ├── competitionService.ts     # OPFS competition management  
│   └── migrationService.ts       # Legacy session migration
├── hooks/
│   └── useCompetitionSystem.ts   # Main hook integrating all functionality
└── components/
    ├── CompetitionSelector.tsx   # Dropdown for switching competitions
    ├── CreateCompetitionButton.tsx # Create new competition with warnings
    ├── CleanupModal.tsx          # User-confirmed cleanup suggestions
    └── CompetitionManager.tsx     # Complete integration component
```

### OPFS Storage Structure

```
OPFS Root/
├── competitions-index.json      # Metadata for all competitions
└── competitions/
    ├── comp-xxx-yyy/
    │   ├── session.json         # Competition session data
    │   └── photos/              # Photos for this competition
    └── comp-zzz-www/
        ├── session.json
        └── photos/
```

## Integration Guide

### Option 1: Replace Existing Hook

Replace `usePhotoSessionOPFS` with `useCompetitionSystem`:

```tsx
// Before
import { usePhotoSessionOPFS } from '../hooks/usePhotoSessionOPFS';

// After  
import { useCompetitionSystem } from '../hooks/useCompetitionSystem';

function MyComponent() {
  const {
    session,                    // Current competition's session
    addPhotosToSet,            // Same API as before
    removePhoto,               // Same API as before
    updatePhotoState,          // Same API as before
    // ... all existing functions work the same
    
    // New competition management
    currentCompetition,        // Current competition metadata
    competitions,              // All competitions list
    createNewCompetition,      // Create new competition
    switchToCompetition,       // Switch active competition
    cleanupCandidates,         // Cleanup suggestions
    // ...
  } = useCompetitionSystem();
  
  // Rest of component unchanged - session works exactly the same
}
```

### Option 2: Use CompetitionManager Wrapper

Wrap your existing components with the new system:

```tsx
import { CompetitionManager } from '../components/CompetitionManager';

function App() {
  return (
    <CompetitionManager>
      {(competitionHook) => (
        <YourExistingPhotoComponents 
          session={competitionHook.session}
          addPhotosToSet={competitionHook.addPhotosToSet}
          // ... pass through all the existing props
        />
      )}
    </CompetitionManager>
  );
}
```

### Option 3: Manual Integration

Use individual components where needed:

```tsx
import { CompetitionSelector } from '../components/CompetitionSelector';
import { CreateCompetitionButton } from '../components/CreateCompetitionButton';

function Header() {
  const { competitions, currentCompetition, switchToCompetition, createNewCompetition } = useCompetitionSystem();
  
  return (
    <Box>
      <CompetitionSelector 
        competitions={competitions}
        currentCompetitionId={currentCompetition?.id}
        onCompetitionChange={switchToCompetition}
      />
      <CreateCompetitionButton onCreateCompetition={createNewCompetition} />
    </Box>
  );
}
```

## Migration Process

### Automatic Migration
- **Trigger**: First app load after implementation
- **Detection**: Checks if competitions exist; if not, looks for legacy session
- **Process**: Converts existing session to "Competition 1" / "Soutěž 1"
- **Cleanup**: Removes old session directory after successful migration
- **Fallback**: Creates empty first competition if no legacy session found

### Migration Examples

```
Before: /sessions/session-123/session.json + photos/
After:  /competitions/comp-456/session.json + photos/
```

## User Experience

### Competition Creation
1. User clicks "Create New Competition" button
2. Storage warning dialog appears showing:
   - Current storage usage percentage
   - Number of existing competitions (X/10)
   - Option to enter custom competition name
3. User confirms → New competition created and becomes active

### Cleanup Flow
1. App startup checks for cleanup candidates
2. Modal appears showing competitions to delete:
   - Age-based: >30 days old
   - Excess: Beyond 10 competition limit
3. User can select/deselect competitions to delete
4. User confirms → Selected competitions permanently deleted

### Competition Switching
1. User selects competition from dropdown
2. App loads that competition's photos and settings
3. All photo operations now affect the selected competition

## Storage Management

### Limits & Warnings
- **Max Competitions**: 10 (oldest auto-suggested for cleanup)
- **Max Age**: 30 days (older auto-suggested for cleanup)
- **Storage Warnings**: At 80% OPFS usage
- **Storage Critical**: At 95% OPFS usage (blocks new competition creation)

### Size Estimation
- **Session Metadata**: ~10KB per competition
- **Photos**: Actual file size tracked for accurate storage reporting
- **Total**: Displayed in cleanup dialogs and storage warnings

## Localization

### Added Translation Keys

```json
// en.json
"competition": {
  "numbered": "Competition {{number}}",
  "createNew": "Create New Competition", 
  "current": "Current: {{name}}",
  "photos": "{{count}} photos",
  "selectCompetition": "Select Competition"
},
"cleanup": {
  "title": "Storage Cleanup Suggestions",
  "willFree": "This will free approximately {{size}} of storage",
  // ... more cleanup translations
}

// cs.json  
"competition": {
  "numbered": "Soutěž {{number}}",
  "createNew": "Vytvořit novou soutěž",
  // ... Czech translations
}
```

## API Reference

### useCompetitionSystem Hook

```typescript
interface UseCompetitionSystemResult {
  // Current state
  currentCompetition: Competition | null;
  competitions: CompetitionMetadata[];
  loading: boolean;
  error: string | null;
  
  // Competition management  
  createNewCompetition: (name?: string) => Promise<void>;
  switchToCompetition: (id: string) => Promise<void>;
  deleteCompetition: (id: string) => Promise<void>;
  updateCompetitionName: (name: string) => Promise<void>;
  
  // Session operations (same API as usePhotoSessionOPFS)
  session: ApiPhotoSession | null;
  addPhotosToSet: (files: File[], setKey: 'set1' | 'set2') => Promise<void>;
  removePhoto: (setKey: 'set1' | 'set2', photoId: string) => Promise<void>;
  updatePhotoState: (setKey: 'set1' | 'set2', photoId: string, canvasState: any) => Promise<void>;
  // ... all existing session operations
  
  // Cleanup & storage
  cleanupCandidates: CleanupCandidate[];
  storageStats: StorageStats | null;
  performCleanup: (candidates: CleanupCandidate[]) => Promise<void>;
  dismissCleanup: () => void;
}
```

## Implementation Complete! 🎉

All core functionality has been implemented:
- ✅ Competition-based versioning system
- ✅ Automatic migration from existing sessions  
- ✅ User-controlled cleanup with 30-day/10-competition limits
- ✅ Storage monitoring and warnings
- ✅ Complete UI components with Material-UI
- ✅ Multi-language support (EN/CS)
- ✅ Backward-compatible API

The system is ready for integration into the existing photo-helper application.
