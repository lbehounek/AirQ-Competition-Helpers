import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// Regression guard for temporal-dead-zone (TDZ) crashes in AppApi's hook
// ordering. Three separate "Cannot access 'X' before initialization" bugs
// shipped because tsc doesn't flag TDZ and NOTHING rendered AppApi:
//   1. pmcSessionApi useMemo read `handleReflowError` declared ~100 lines below.
//   2. (fix for 1) `handleReflowError` then read `t` declared ~80 lines below.
// This test mounts the real AppApi component. With `session: null` the component
// bails to the light "Creating New Session…" branch, but the ENTIRE component
// body above that early return — every useMemo/useCallback and its deps array,
// where TDZ throws — still executes. A reordered const that's used before its
// declaration throws a ReferenceError during render and fails this test.

// Heavy / environment-bound dependencies stubbed so the render reaches AppApi's
// own body (the thing under test) rather than spinning up OPFS, WebGL, etc.
vi.mock('../hooks/useCompetitionSystem', () => ({
  useCompetitionSystem: () => ({
    // session null → early "Creating New Session…" return after the full body runs.
    session: null,
    sessionId: null,
    loading: false,
    error: null,
    competitions: [],
    currentCompetition: null,
    storageStats: null,
    isDesktopManaged: false,
    // Callbacks referenced in deps arrays / the pmcSessionApi memo — never invoked
    // on the loading path, so bare stubs suffice.
    addPhotosToSet: vi.fn(), removePhoto: vi.fn(), updatePhotoState: vi.fn(),
    updateSetTitle: vi.fn(), updateSessionMode: vi.fn(), updateLayoutMode: vi.fn(),
    updateSessionCompetitionName: vi.fn(), getSessionStats: vi.fn(), clearError: vi.fn(),
    createNewCompetition: vi.fn(), switchToCompetition: vi.fn(), deleteCompetition: vi.fn(),
    cleanupCandidates: vi.fn(), performCleanup: vi.fn(), dismissCleanup: vi.fn(),
    updateStorageStats: vi.fn(), addPhotosToCandidates: vi.fn(), addExistingCandidate: vi.fn(),
    importPickToSets: vi.fn(), reconcilePlacedToSets: vi.fn(), removeCandidate: vi.fn(),
    promoteCandidateToSlot: vi.fn(), addPlaceholderToSet: vi.fn(), demoteSlotToCandidate: vi.fn(),
    setCandidateFlag: vi.fn(), setCandidateLabel: vi.fn(), setCandidateFilename: vi.fn(),
    updateCandidatePhotoState: vi.fn(), deleteCandidates: vi.fn(),
  }),
}));
vi.mock('../hooks/useMapPicksSync', () => ({ useMapPicksSync: () => {} }));
vi.mock('../hooks/useClipboardPaste', () => ({
  useClipboardPaste: () => ({ pasteError: null, clearPasteError: vi.fn() }),
}));
vi.mock('../contexts/I18nContext', () => ({
  useI18n: () => ({ t: (k: string) => k, locale: 'en', setLocale: vi.fn() }),
}));
vi.mock('../contexts/AspectRatioContext', () => ({
  useAspectRatio: () => ({ currentRatio: undefined }),
}));
vi.mock('../contexts/LabelingContext', () => ({
  useLabeling: () => ({ generateLabel: vi.fn() }),
}));
vi.mock('../contexts/LayoutModeContext', () => ({
  useLayoutMode: () => ({ setLayoutMode: vi.fn(), layoutMode: 'landscape' }),
}));

import AppApi from '../AppApi';

describe('AppApi render smoke (TDZ guard)', () => {
  beforeEach(() => {
    // MUI useMediaQuery needs matchMedia, absent in jsdom.
    window.matchMedia = window.matchMedia || ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList));
  });
  afterEach(() => cleanup());

  it('mounts without a temporal-dead-zone ReferenceError (full body executes)', () => {
    // Throws "Cannot access 'X' before initialization" if any const is used
    // before its declaration in the component body.
    expect(() => render(<AppApi />)).not.toThrow();
    // Reached the light early-return branch → the whole body ran cleanly.
    expect(screen.getByText('Creating New Session...')).toBeInTheDocument();
  });
});
