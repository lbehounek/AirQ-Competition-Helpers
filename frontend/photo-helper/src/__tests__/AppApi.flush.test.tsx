/**
 * The navigation choke points AppApi owns, and the competition-switch hazard
 * that sits next to them.
 *
 * Everything the coalesced write queue buys is paid back at a FLUSH: a burst of
 * edits is only one `session.json` write because the last one wins, so whatever
 * is still owed has to be drained before the page goes away or the competition
 * changes underneath it. Those drains were wired but never pinned — the effect
 * and the two desktop buttons could all be deleted with a green suite.
 *
 * The second half pins the dirs handed to the candidate tray. Thumb generation
 * is module-level and uncancellable, so a tray that is handed the PREVIOUS
 * competition's `photos/` for even one commit writes the NEW competition's
 * thumbs into the OLD competition's directory.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import type { DirectoryHandle } from '@airq/shared-storage';
import { makeCanvasState } from './support/testHelpers';
import type { ApiPhoto } from '../types/api';

// `vi.mock` factories are hoisted above every const in the file, so the spies
// they close over have to be hoisted with them.
const { flushPersistence, flushPendingEditorPicks } = vi.hoisted(() => ({
  flushPersistence: vi.fn(async () => {}),
  flushPendingEditorPicks: vi.fn(async () => {}),
}));

/** Competition currently returned by the mocked hook; swapped to drive a switch. */
let currentCompetition = { id: 'comp-A', name: 'Alpha' };
/** Candidate ids of the competition currently returned by the mocked hook. */
let candidateIds = ['a1'];
let isDesktopManaged = false;

const makePhoto = (id: string): ApiPhoto => ({
  id,
  sessionId: 'sess-1',
  url: `blob:${id}`,
  label: id.toUpperCase(),
  filename: `${id}.jpg`,
  canvasState: makeCanvasState(),
});

vi.mock('../hooks/useCompetitionSystem', () => ({
  useCompetitionSystem: () => ({
    session: {
      id: 'sess-1',
      competition_name: currentCompetition.name,
      mode: 'track' as const,
      layoutMode: 'landscape' as const,
      sets: {
        set1: { title: 'Set 1', photos: [makePhoto('p1')] },
        set2: { title: 'Set 2', photos: [] },
      },
      candidates: { photos: candidateIds.map(makePhoto) },
    },
    sessionId: 'sess-1',
    loading: false,
    error: null,
    competitions: [currentCompetition],
    currentCompetition,
    storageStats: null,
    isDesktopManaged,
    getSessionStats: () => ({ totalPhotos: 1, set1Photos: 1, set2Photos: 0 }),
    addPhotosToSet: vi.fn(), removePhoto: vi.fn(), updatePhotoState: vi.fn(),
    updateSetTitle: vi.fn(), updateSetTitles: vi.fn(), updateSessionMode: vi.fn(),
    updateLayoutMode: vi.fn(), updateSessionCompetitionName: vi.fn(), clearError: vi.fn(),
    createNewCompetition: vi.fn(), switchToCompetition: vi.fn(), deleteCompetition: vi.fn(),
    cleanupCandidates: vi.fn(), performCleanup: vi.fn(), dismissCleanup: vi.fn(),
    updateStorageStats: vi.fn(), addPhotosToCandidates: vi.fn(), addExistingCandidate: vi.fn(),
    importPickToSets: vi.fn(), reconcilePlacedToSets: vi.fn(), removeCandidate: vi.fn(),
    promoteCandidateToSlot: vi.fn(), addPlaceholderToSet: vi.fn(), demoteSlotToCandidate: vi.fn(),
    setCandidateFlag: vi.fn(), setCandidateLabel: vi.fn(), setCandidateFilename: vi.fn(),
    updateCandidatePhotoState: vi.fn(), deleteCandidates: vi.fn(),
    flushPersistence,
  }),
}));

vi.mock('../handoff/editorPicksWriter', () => ({
  buildEditorPicks: () => [],
  scheduleWriteEditorPicks: vi.fn(),
  flushPendingEditorPicks,
}));

// Directory resolution: `competitions/{id}/photos`, keyed by path exactly like
// the real OPFS layout so the tray probe below can name which competition it
// was handed.
vi.mock('@airq/shared-storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@airq/shared-storage')>()),
  getStorage: () => ({
    init: async () => ({ root: { path: '/' }, sessions: { path: '/sessions' } }),
    getDirectoryHandle: async (parent: DirectoryHandle, name: string) => ({
      path: parent.path === '/' ? `/${name}` : `${parent.path}/${name}`,
    }),
  }),
}));

vi.mock('../hooks/useMapPicksSync', () => ({ useMapPicksSync: () => {} }));
vi.mock('../hooks/useClipboardPaste', () => ({
  useClipboardPaste: () => ({ pasteError: null, clearPasteError: vi.fn() }),
}));
vi.mock('../contexts/I18nContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../contexts/I18nContext')>()),
  useI18n: () => ({ t: (k: string) => k, locale: 'en', setLocale: vi.fn() }),
}));
vi.mock('../contexts/AspectRatioContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../contexts/AspectRatioContext')>()),
  useAspectRatio: () => ({ currentRatio: { id: '4:3', label: '4:3', ratio: 4 / 3 } }),
}));
vi.mock('../contexts/LabelingContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../contexts/LabelingContext')>()),
  useLabeling: () => ({ generateLabel: (i: number) => String.fromCharCode(65 + i) }),
}));
vi.mock('../contexts/LayoutModeContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../contexts/LayoutModeContext')>()),
  useLayoutMode: () => ({ setLayoutMode: vi.fn(), layoutMode: 'landscape' }),
}));

/**
 * Every `(photosDir, candidate ids)` pair the tray was rendered with, in order.
 * The switch hazard is invisible in the final state — it is a single
 * intermediate commit — so the probe has to record the whole sequence.
 */
const { trayRenders } = vi.hoisted(() => ({
  trayRenders: [] as Array<{ dirPath: string | null | undefined; ids: string[] }>,
}));
vi.mock('../components/CandidateTray', () => ({
  CandidateTray: ({ photos, photosDir }: { photos: ApiPhoto[]; photosDir?: DirectoryHandle | null }) => {
    trayRenders.push({ dirPath: photosDir === undefined ? undefined : photosDir?.path ?? null, ids: photos.map(p => p.id) });
    return null;
  },
}));

vi.mock('../components/PhotoGridApi', () => ({ PhotoGridApi: () => null }));
vi.mock('../components/GridSizedDropZone', () => ({ GridSizedDropZone: () => null }));
vi.mock('../components/TurningPointLayout', () => ({ TurningPointLayout: () => null }));
vi.mock('../components/PhotoEditorModalBody', () => ({ PhotoEditorModalBody: () => null }));
vi.mock('../components/AspectRatioSelector', () => ({ AspectRatioSelector: () => null }));
vi.mock('../components/LabelingSelector', () => ({ LabelingSelector: () => null }));
vi.mock('../components/ModeSelector', () => ({ ModeSelector: () => null }));
vi.mock('../components/LayoutModeSelector', () => ({ LayoutModeSelector: () => null }));
vi.mock('../components/CompetitionSelector', () => ({ CompetitionSelector: () => null }));
vi.mock('../components/CreateCompetitionButton', () => ({ CreateCompetitionButton: () => null }));
vi.mock('../components/ImportPhotosControl', () => ({ ImportPhotosControl: () => null }));
vi.mock('../components/CleanupModal', () => ({ CleanupModal: () => null }));
vi.mock('../onboarding/photoHelperTour', () => ({
  startPhotoHelperTour: vi.fn(),
  startEditorModalTour: vi.fn(),
  scheduleAutoStartTour: vi.fn(() => () => {}),
  markTourSeen: vi.fn(),
}));

import AppApi from '../AppApi';

/** Force `document.visibilityState`, which jsdom exposes read-only. */
function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  trayRenders.length = 0;
  currentCompetition = { id: 'comp-A', name: 'Alpha' };
  candidateIds = ['a1'];
  isDesktopManaged = false;
  setVisibility('visible');
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList));
});
afterEach(() => {
  cleanup();
  delete (window as { electronAPI?: unknown }).electronAPI;
});

describe('AppApi — last-chance drains', () => {
  it('flushes persistence and the editor picks on pagehide', async () => {
    render(<AppApi />);
    expect(flushPersistence).not.toHaveBeenCalled();

    await act(async () => { window.dispatchEvent(new Event('pagehide')); });

    expect(flushPersistence).toHaveBeenCalledTimes(1);
    expect(flushPendingEditorPicks).toHaveBeenCalledTimes(1);
  });

  it('flushes when the page is hidden, but not when it becomes visible', async () => {
    render(<AppApi />);

    // The "visible" transition fires the same event and must be ignored —
    // otherwise every alt-tab back into the app costs a redundant drain.
    setVisibility('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(flushPersistence).not.toHaveBeenCalled();

    setVisibility('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(flushPersistence).toHaveBeenCalledTimes(1);
    expect(flushPendingEditorPicks).toHaveBeenCalledTimes(1);
  });

  it('stops flushing once unmounted', async () => {
    const { unmount } = render(<AppApi />);
    unmount();

    await act(async () => { window.dispatchEvent(new Event('pagehide')); });
    expect(flushPersistence).not.toHaveBeenCalled();
  });
});

describe('AppApi — desktop navigation drains before it leaves', () => {
  /** Install a desktop bridge whose two nav channels record their call order. */
  function installBridge() {
    const goHome = vi.fn(async () => {});
    const navigateToApp = vi.fn(async () => {});
    (window as { electronAPI?: unknown }).electronAPI = { goHome, navigateToApp };
    isDesktopManaged = true;
    return { goHome, navigateToApp };
  }

  it('drains before goHome tears the renderer down', async () => {
    const { goHome } = installBridge();
    render(<AppApi />);

    await act(async () => { screen.getByTitle('app.backToMenu').click(); });

    await waitFor(() => expect(goHome).toHaveBeenCalledTimes(1));
    expect(flushPersistence).toHaveBeenCalledTimes(1);
    // Order, not just presence: the shell may kill the renderer the moment
    // `goHome` resolves, so an owed write started afterwards would be lost.
    expect(flushPersistence.mock.invocationCallOrder[0])
      .toBeLessThan(goHome.mock.invocationCallOrder[0]);
  });

  it('drains before handing the same competition to map-corridors', async () => {
    const { navigateToApp } = installBridge();
    render(<AppApi />);

    await act(async () => { screen.getByRole('button', { name: /app.switchToPlacement/ }).click(); });

    await waitFor(() => expect(navigateToApp).toHaveBeenCalledTimes(1));
    expect(flushPersistence).toHaveBeenCalledTimes(1);
    // The other app opens the SAME competition directory — an owed write that
    // lands after it has read `session.json` is a lost edit, not a late one.
    expect(flushPersistence.mock.invocationCallOrder[0])
      .toBeLessThan(navigateToApp.mock.invocationCallOrder[0]);
  });
});

describe('AppApi — candidate dirs across a competition switch', () => {
  it('never hands the tray one competition’s photos dir with another’s candidates', async () => {
    const { rerender } = render(<AppApi />);
    // Let A's dirs resolve.
    await waitFor(() =>
      expect(trayRenders.some(r => r.dirPath === '/competitions/comp-A/photos')).toBe(true));

    // The switch: the hook publishes B's competition AND B's candidates in one
    // commit. AppApi's dir-resolution effect cannot have run yet.
    currentCompetition = { id: 'comp-B', name: 'Bravo' };
    candidateIds = ['b1', 'b2'];
    await act(async () => { rerender(<AppApi />); });
    await waitFor(() =>
      expect(trayRenders.some(r => r.dirPath === '/competitions/comp-B/photos')).toBe(true));

    // The thumbnail resolver is module-level and cannot be cancelled once it
    // has a dir, so ONE render with the wrong pairing is enough to write B's
    // thumbs into A's `photos/thumbs/` — and mark them persisted, so B never
    // gets them at all.
    const crossed = trayRenders.filter(r =>
      r.dirPath === '/competitions/comp-A/photos' && r.ids.some(id => id.startsWith('b')));
    expect(crossed).toEqual([]);

    // ...and the mirror image, so a fix that simply stops passing a dir at all
    // would not pass: B's candidates do reach the tray with B's dir.
    expect(trayRenders.some(r =>
      r.dirPath === '/competitions/comp-B/photos' && r.ids.join() === 'b1,b2')).toBe(true);
  });
});
