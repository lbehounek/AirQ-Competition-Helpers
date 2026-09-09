/**
 * The UI half of the export-progress feature: while `generatePDF` runs, the
 * Generate button is disabled and a caption reports what the export is doing.
 *
 * `generatePDF` is mocked with a DEFERRED promise so the assertions can run
 * mid-export — which is the whole point, since the real export now yields to
 * the event loop and the button would otherwise be clickable again.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor, fireEvent } from '@testing-library/react';
import type { PdfProgress } from '../utils/pdfGenerator';
import { makeCanvasState } from './support/testHelpers';

/** Resolver + captured `onProgress` of the in-flight mocked export. */
let resolveExport: (() => void) | null = null;
let rejectExport: ((error: unknown) => void) | null = null;
let capturedOnProgress: ((progress: PdfProgress) => void) | null = null;

const generatePDFMock = vi.fn((...args: unknown[]) => {
  const options = args[9] as { onProgress?: (p: PdfProgress) => void } | undefined;
  capturedOnProgress = options?.onProgress ?? null;
  return new Promise<void>((resolve, reject) => {
    resolveExport = () => resolve();
    rejectExport = (error: unknown) => reject(error);
  });
});

vi.mock('../utils/pdfGenerator', () => ({ generatePDF: (...args: unknown[]) => generatePDFMock(...args) }));

/** A session with two photos in set1 so the export button is enabled. */
const makePhoto = (id: string) => ({
  id,
  url: `blob:${id}`,
  label: id.toUpperCase(),
  filename: `${id}.jpg`,
  canvasState: makeCanvasState(),
});

const session = {
  id: 'sess-1',
  competition_name: 'Test Cup',
  mode: 'track' as const,
  layoutMode: 'landscape' as const,
  sets: {
    set1: { title: 'Set 1', photos: [makePhoto('p1'), makePhoto('p2')] },
    set2: { title: 'Set 2', photos: [] },
  },
};

vi.mock('../hooks/useCompetitionSystem', () => ({
  useCompetitionSystem: () => ({
    session,
    sessionId: 'sess-1',
    loading: false,
    error: null,
    competitions: [{ id: 'comp-1', name: 'Test Cup' }],
    currentCompetition: { id: 'comp-1', name: 'Test Cup' },
    storageStats: null,
    isDesktopManaged: false,
    candidatePhotos: [],
    getSessionStats: () => ({ totalPhotos: 2, set1Photos: 2, set2Photos: 0 }),
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
    flushPersistence: vi.fn(async () => {}),
  }),
}));
vi.mock('../hooks/useMapPicksSync', () => ({ useMapPicksSync: () => {} }));
vi.mock('../hooks/useClipboardPaste', () => ({
  useClipboardPaste: () => ({ pasteError: null, clearPasteError: vi.fn() }),
}));

// Translate by echoing the key plus its params, so a caption assertion proves
// BOTH the key choice and the interpolation payload.
vi.mock('../contexts/I18nContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../contexts/I18nContext')>()),
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    locale: 'en',
    setLocale: vi.fn(),
  }),
}));
// Partial mock: the selector components read the real `ASPECT_RATIO_OPTIONS`
// constant from this module, so only the hook is replaced.
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

// Heavy children: this test is about the export button and its caption, not
// about the grid, the tray, or the editor modal.
vi.mock('../components/PhotoGridApi', () => ({ PhotoGridApi: () => null }));
vi.mock('../components/GridSizedDropZone', () => ({ GridSizedDropZone: () => null }));
vi.mock('../components/TurningPointLayout', () => ({ TurningPointLayout: () => null }));
vi.mock('../components/CandidateTray', () => ({ CandidateTray: () => null }));
vi.mock('../components/PhotoEditorModalBody', () => ({ PhotoEditorModalBody: () => null }));
// The selector row renders straight off the real context modules, which the
// hook mocks above deliberately do not fully populate — stub the widgets.
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

/** The export button, found by the translated (echoed) label key. */
const exportButton = () => screen.getByRole('button', { name: 'actions.generatePdf' });

describe('AppApi PDF export progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveExport = null;
    rejectExport = null;
    capturedOnProgress = null;
    window.matchMedia = window.matchMedia || ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList));
  });
  afterEach(() => cleanup());

  it('disables the button and shows progress for the duration of the export', async () => {
    render(<AppApi />);
    const button = exportButton();
    expect(button).toBeEnabled();
    expect(screen.queryByTestId('pdf-progress')).not.toBeInTheDocument();

    await act(async () => {
      button.click();
    });

    // Busy: button locked, indicator present, caption seeded at 0/0.
    expect(exportButton()).toBeDisabled();
    expect(screen.getByTestId('pdf-progress')).toBeInTheDocument();
    expect(screen.getByText('pdf.progress.rendering:{"done":0,"total":0}')).toBeInTheDocument();

    // A render tick from the export updates the caption.
    await act(async () => {
      capturedOnProgress?.({ phase: 'render', done: 3, total: 9 });
    });
    expect(screen.getByText('pdf.progress.rendering:{"done":3,"total":9}')).toBeInTheDocument();

    // Later phases swap the caption for their own key.
    await act(async () => {
      capturedOnProgress?.({ phase: 'compose', done: 9, total: 9 });
    });
    expect(screen.getByText('pdf.progress.composing')).toBeInTheDocument();

    await act(async () => {
      capturedOnProgress?.({ phase: 'save', done: 9, total: 9 });
    });
    expect(screen.getByText('pdf.progress.saving')).toBeInTheDocument();

    // Finished: indicator gone, button usable again.
    await act(async () => {
      resolveExport?.();
    });
    await waitFor(() => expect(screen.queryByTestId('pdf-progress')).not.toBeInTheDocument());
    expect(exportButton()).toBeEnabled();
  });

  it('passes onProgress as the tenth argument', async () => {
    render(<AppApi />);

    await act(async () => {
      exportButton().click();
    });

    expect(generatePDFMock).toHaveBeenCalledTimes(1);
    expect(generatePDFMock.mock.calls[0][9]).toEqual({ onProgress: expect.any(Function) });

    await act(async () => {
      resolveExport?.();
    });
  });

  it('clears the busy state when the export fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<AppApi />);

    await act(async () => {
      exportButton().click();
    });
    expect(exportButton()).toBeDisabled();

    await act(async () => {
      rejectExport?.(Object.assign(new Error('boom'), { renderFailures: [{ photoId: 'p1' }] }));
    });

    await waitFor(() => expect(exportButton()).toBeEnabled());
    expect(screen.queryByTestId('pdf-progress')).not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('disables the button while an export is running', async () => {
    render(<AppApi />);

    await act(async () => { exportButton().click(); });
    expect(exportButton()).toBeDisabled();

    await act(async () => { resolveExport?.(); });
  });

  it('a second click cannot start a second export', async () => {
    // What stops it is the `disabled` PROP, and only that. Two things were
    // measured here rather than assumed: jsdom's HTMLElement.click() returns
    // without dispatching anything for a disabled form control, AND stripping
    // the DOM attribute does not help either, because React's event system
    // reads the prop (`getListener` refuses onClick for a disabled interactive
    // element) — with `if (pdfProgress !== null) return;` deleted from
    // `handleGeneratePDF`, both shapes still produce exactly one export.
    //
    // So that early return is defence-in-depth for a future caller that is not
    // this button; it is NOT what this path exercises, and no test here should
    // claim otherwise. The property that actually protects the user is the
    // disabled prop, pinned in the case above and at the top of this file.
    render(<AppApi />);

    await act(async () => { exportButton().click(); });
    expect(generatePDFMock).toHaveBeenCalledTimes(1);

    const button = exportButton();
    await act(async () => { button.click(); });
    button.removeAttribute('disabled');
    await act(async () => { fireEvent.click(button); });

    expect(generatePDFMock).toHaveBeenCalledTimes(1);

    await act(async () => { resolveExport?.(); });
  });

  it('tells the user to reload when the lazy export module cannot be fetched', async () => {
    // The web build rsyncs --delete, so a tab open across a deploy can no
    // longer fetch the old hashed chunk. The browser caches that failed module
    // fetch, so "Please try again" would send the user round a loop that can
    // never succeed.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<AppApi />);

    await act(async () => { exportButton().click(); });
    await act(async () => {
      rejectExport?.(Object.assign(new Error('PDF export module failed to load'), {
        chunkLoadFailed: true,
      }));
    });

    expect(await screen.findByText('pdf.error.moduleLoad')).toBeInTheDocument();
    expect(screen.queryByText('pdf.error.generic')).not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('falls back to the generic message for an untagged failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<AppApi />);

    await act(async () => { exportButton().click(); });
    await act(async () => { rejectExport?.(new Error('boom')); });

    expect(await screen.findByText('pdf.error.generic')).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
