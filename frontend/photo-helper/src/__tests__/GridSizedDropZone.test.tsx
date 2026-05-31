import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { GridSizedDropZone } from '../components/GridSizedDropZone';
import { serializeDragPayload, DRAG_PAYLOAD_MIME } from '../utils/dragPayload';

// Regression cover for the empty-set drag-drop bug: dropping a candidate-tray
// thumb onto an EMPTY set (which renders GridSizedDropZone, not PhotoGridApi)
// did nothing because the zone only handled native file drops. These pin the
// internal `application/x-airq-photo` channel added to make tray drops work,
// while keeping the native file-drop path (react-dropzone) untouched.

// Echo-style t() so we can find rendered strings by their i18n key, and avoid
// spinning up the real I18nContext.
vi.mock('../contexts/I18nContext', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

// currentRatio.ratio is the only field read (grid aspect-ratio math).
vi.mock('../contexts/AspectRatioContext', () => ({
  useAspectRatio: () => ({ currentRatio: { ratio: 1.5 } }),
}));

// Electron import path disabled in tests → web dropzone behaviour.
vi.mock('../hooks/useElectronPhotoImport', () => ({
  useElectronPhotoImport: () => ({
    isAvailable: false,
    isImporting: false,
    importError: null,
    pickPhotos: vi.fn(),
    clearImportError: vi.fn(),
  }),
}));

/**
 * Map-backed DataTransfer shim — jsdom doesn't implement the constructor.
 * `types` is derived from the keys so `types.includes(MIME)` works.
 */
function makeDataTransfer(initial: Record<string, string> = {}): DataTransfer {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    types: [...store.keys()],
    getData: (mime: string) => store.get(mime) ?? '',
    setData: (mime: string, value: string) => { store.set(mime, value); },
    dropEffect: 'move',
    effectAllowed: 'move',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    clearData: () => store.clear(),
    setDragImage: () => {},
  } as unknown as DataTransfer;
}

function renderZone(overrides: Partial<React.ComponentProps<typeof GridSizedDropZone>> = {}) {
  const props: React.ComponentProps<typeof GridSizedDropZone> = {
    onFilesDropped: vi.fn(),
    setName: 'Set 1',
    maxPhotos: 9,
    setKey: 'set1',
    ...overrides,
  };
  const result = render(<GridSizedDropZone {...props} />);
  // The dropzone Paper carries the handlers; locate it via the rest-state hint.
  const dropTarget = screen.getByText('upload.clickOrDrop').closest('.MuiPaper-root') as HTMLElement;
  return { ...result, props, dropTarget };
}

afterEach(() => {
  cleanup();
});

describe('GridSizedDropZone — candidate-tray drop channel (empty-set fix)', () => {
  it('fires onCandidateDropped with the photo id when a tray payload is dropped', () => {
    const onCandidateDropped = vi.fn();
    const { dropTarget } = renderZone({ onCandidateDropped });
    fireEvent.drop(dropTarget, {
      dataTransfer: makeDataTransfer({
        [DRAG_PAYLOAD_MIME]: serializeDragPayload({ kind: 'tray', photoId: 'p1' }),
      }),
    });
    expect(onCandidateDropped).toHaveBeenCalledTimes(1);
    expect(onCandidateDropped).toHaveBeenCalledWith('p1');
  });

  it('routes a cross-set slot drop to onCrossSetDropRejected (not onCandidateDropped)', () => {
    const onCandidateDropped = vi.fn();
    const onCrossSetDropRejected = vi.fn();
    const { dropTarget } = renderZone({ setKey: 'set1', onCandidateDropped, onCrossSetDropRejected });
    fireEvent.drop(dropTarget, {
      dataTransfer: makeDataTransfer({
        // A slot photo dragged from the OTHER set (set2) onto this empty set1.
        [DRAG_PAYLOAD_MIME]: serializeDragPayload({
          kind: 'slot', setKey: 'set2', index: 0, photoId: 'slot-x',
        }),
      }),
    });
    expect(onCrossSetDropRejected).toHaveBeenCalledTimes(1);
    expect(onCandidateDropped).not.toHaveBeenCalled();
  });

  it('does not hijack a native file drop (no internal payload → onCandidateDropped untouched)', () => {
    const onCandidateDropped = vi.fn();
    const { dropTarget } = renderZone({ onCandidateDropped });
    // A plain drop with no internal MIME — react-dropzone owns this path; our
    // handler must bail out and leave onCandidateDropped alone.
    fireEvent.drop(dropTarget, { dataTransfer: makeDataTransfer() });
    expect(onCandidateDropped).not.toHaveBeenCalled();
  });
});
