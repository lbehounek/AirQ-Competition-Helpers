import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CandidateTray, type CandidateTrayProps } from '../components/CandidateTray';
import { serializeDragPayload, DRAG_PAYLOAD_MIME } from '../utils/dragPayload';
import { useCandidateThumbUrl } from '../hooks/useCandidateThumbUrl';
import { invalidateCandidateThumb } from '../utils/candidateThumbs';
import type { DirectoryHandle } from '@airq/shared-storage';
import type { ApiPhoto, CandidateFlag } from '../types/api';
import { makeCanvasState } from './support/testHelpers';

// PR #62 review G7: the new CandidateTray component (516 LOC) shipped with
// zero direct tests. The empty-state branch is the only entry point for
// "drop more photos" once all slots are full (CRIT-2 fix made native drops
// actually work via getRootProps composition). Pin those behaviours.

// Stub `useI18n` so we don't need to spin up the whole I18nContext. Echoes
// the key back so assertions can check `t('candidates.poolLabel')` →
// the literal string `'candidates.poolLabel'`.
vi.mock('../contexts/I18nContext', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

// Stub the thumbnail tier. `CandidateThumbImage` itself is rendered for real
// (it is the thing the tray now mounts per candidate), but its hook is mocked:
// the real one calls `getStorage()` — which throws before `initStorage()` — and
// `URL.createObjectURL`, which jsdom cannot round-trip. Hook behaviour has its
// own suite in useCandidateThumbUrl.test.tsx.
vi.mock('../hooks/useCandidateThumbUrl', () => ({
  useCandidateThumbUrl: vi.fn((photo: ApiPhoto) => ({
    url: `thumb:${photo.id}`,
    state: 'ready' as const,
  })),
}));
vi.mock('../utils/candidateThumbs', () => ({
  invalidateCandidateThumb: vi.fn(),
}));

const thumbHookMock = vi.mocked(useCandidateThumbUrl);
const invalidateMock = vi.mocked(invalidateCandidateThumb);

/** Force every thumb into one view state for a render. */
function stubThumbView(view: { url: string | null; state: 'loading' | 'ready' | 'fallback' | 'missing' }) {
  thumbHookMock.mockImplementation(() => view);
}

const testPhotosDir: DirectoryHandle = { path: '/competitions/c1/photos' };

function p(id: string, flag?: CandidateFlag): ApiPhoto {
  return {
    id,
    sessionId: 'sess-1',
    url: `blob:${id}`,
    filename: `${id}.jpg`,
    canvasState: makeCanvasState(),
    label: '',
    ...(flag !== undefined ? { flag } : {}),
  };
}

function renderTray(overrides: Partial<CandidateTrayProps> = {}) {
  const props: CandidateTrayProps = {
    photos: [],
    onAddFiles: vi.fn(),
    onPhotoClick: vi.fn(),
    onSetFlag: vi.fn(),
    onDelete: vi.fn(),
    onSendToSet: vi.fn(),
    onSlotDroppedIn: vi.fn(),
    photosDir: testPhotosDir,
    ...overrides,
  };
  const result = render(<CandidateTray {...props} />);
  return { ...result, props };
}

/**
 * Build a DataTransfer-ish object that jsdom accepts on synthetic drop
 * events. The native `DataTransfer` constructor isn't implemented; we
 * stub `getData` / `setData` / `types` with a Map-backed shim.
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

afterEach(() => {
  cleanup();
});

describe('CandidateTray — empty state (PR #62 review CRIT-2 fix region)', () => {
  it('renders the candidate-pool drop hint when no photos are present', () => {
    renderTray();
    // Two text nodes from the empty branch — the bold pool label and the
    // accessibility hint.
    expect(screen.getByText('candidates.poolLabel')).toBeInTheDocument();
    expect(screen.getByText('candidates.emptyHint')).toBeInTheDocument();
  });

  it('fires `onSlotDroppedIn` when a slot-source payload is dropped on the empty zone', () => {
    const onSlotDroppedIn = vi.fn();
    renderTray({ onSlotDroppedIn });
    const dropTarget = screen.getByText('candidates.poolLabel').closest('div')!;
    // Synthesise a slot-drag dataTransfer. CRIT-2 fix: handlers now compose
    // through getRootProps, so the user-supplied onDrop fires for both the
    // internal payload (this test) and native files (next test).
    const dataTransfer = makeDataTransfer({
      [DRAG_PAYLOAD_MIME]: serializeDragPayload({
        kind: 'slot', setKey: 'set1', index: 2, photoId: 'photo-X',
      }),
    });
    fireEvent.drop(dropTarget, { dataTransfer });
    expect(onSlotDroppedIn).toHaveBeenCalledTimes(1);
    expect(onSlotDroppedIn).toHaveBeenCalledWith({ setKey: 'set1', photoId: 'photo-X' });
  });

  it('ignores tray-source drag payloads (no-op in empty state)', () => {
    const onSlotDroppedIn = vi.fn();
    renderTray({ onSlotDroppedIn });
    const dropTarget = screen.getByText('candidates.poolLabel').closest('div')!;
    fireEvent.drop(dropTarget, {
      dataTransfer: makeDataTransfer({
        [DRAG_PAYLOAD_MIME]: serializeDragPayload({ kind: 'tray', photoId: 'tray-A' }),
      }),
    });
    expect(onSlotDroppedIn).not.toHaveBeenCalled();
  });

  it('ignores malformed drag payloads silently (no crash, no callback)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onSlotDroppedIn = vi.fn();
    renderTray({ onSlotDroppedIn });
    const dropTarget = screen.getByText('candidates.poolLabel').closest('div')!;
    fireEvent.drop(dropTarget, {
      dataTransfer: makeDataTransfer({ [DRAG_PAYLOAD_MIME]: 'not json' }),
    });
    expect(onSlotDroppedIn).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled(); // parseDragPayload logs the failure
    warnSpy.mockRestore();
  });
});

describe('CandidateTray — populated state', () => {
  it('renders the candidates header with count', () => {
    renderTray({ photos: [p('a', 'pick'), p('b'), p('c', 'reject')] });
    // Header title uses t('candidates.title', { count: 3 }) → echoed as
    // `candidates.title:{"count":3}` by our mock t().
    expect(screen.getByText('candidates.title:{"count":3}')).toBeInTheDocument();
  });

  it('hides "Send to Set 2" button when hideSet2 is true (precision-track mode)', () => {
    renderTray({ photos: [p('a')], hideSet2: true });
    // The Send-to-Set-1 button is always rendered; Set-2 is gated behind hideSet2.
    // Tooltip titles use t('candidates.sendToSet1') and t('candidates.sendToSet2').
    // With our echo-style t(), they appear as those exact strings in aria-label /
    // title attributes. We look for the absence of the Set 2 tooltip.
    expect(screen.queryByLabelText('candidates.sendToSet2')).not.toBeInTheDocument();
  });

  it('shows "Send to Set 2" button when hideSet2 is false (default rally mode)', () => {
    renderTray({ photos: [p('a')], hideSet2: false });
    // Multiple elements (tooltip wrapper + button) share the title attribute,
    // so just assert at least one Set-2 affordance is in the DOM.
    expect(screen.queryAllByLabelText('candidates.sendToSet2').length).toBeGreaterThan(0);
  });

  it('renders all photo thumbnails by default (hideRejects off)', () => {
    renderTray({ photos: [p('a', 'pick'), p('b'), p('c', 'reject')] });
    expect(screen.getByTestId('candidate-thumb-a')).toBeInTheDocument();
    expect(screen.getByTestId('candidate-thumb-b')).toBeInTheDocument();
    expect(screen.getByTestId('candidate-thumb-c')).toBeInTheDocument();
  });

  // The "Hide rejects" toggle is part of the pick/reject workflow now hidden
  // from the candidate tray (SHOW_CANDIDATE_FLAG_UI = false, feedback
  // 2026-05-30). The filtering logic is retained and unit-tested in
  // candidateFilter; here we assert the toggle UI is gone.
  it('does not render the "Hide rejects" toggle', () => {
    renderTray({ photos: [p('a', 'pick'), p('b', 'reject'), p('c')] });
    expect(screen.queryByText('candidates.hideRejects')).not.toBeInTheDocument();
  });

  it('fires onSendToSet when a "Send to Set 1" toolbar button is clicked', () => {
    const onSendToSet = vi.fn();
    renderTray({ photos: [p('photo-X')], onSendToSet });
    const sendButtons = screen.getAllByLabelText('candidates.sendToSet1');
    // First match is the tooltip wrapper, last is the actual IconButton.
    fireEvent.click(sendButtons[sendButtons.length - 1]);
    expect(onSendToSet).toHaveBeenCalledWith('photo-X', 'set1');
  });

  // "Send to TP photos" — only rendered when onSendToTP is provided (AppApi
  // passes it in track mode; in turning-point mode set1/set2 are already TP).
  it('does not render the "Send to TP" button when onSendToTP is absent', () => {
    renderTray({ photos: [p('photo-X')] });
    expect(screen.queryByLabelText('candidates.sendToTP')).not.toBeInTheDocument();
  });

  it('fires onSendToTP when the "Send to TP" toolbar button is clicked', () => {
    const onSendToTP = vi.fn();
    renderTray({ photos: [p('photo-X')], onSendToTP });
    const tpButtons = screen.getAllByLabelText('candidates.sendToTP');
    fireEvent.click(tpButtons[tpButtons.length - 1]);
    expect(onSendToTP).toHaveBeenCalledWith('photo-X');
  });

  // Per-thumb star (pick) / block (reject) buttons are intentionally hidden
  // (SHOW_CANDIDATE_FLAG_UI = false) — that selection workflow moved to the Map
  // Corridors app (feedback 2026-05-30). onSetFlag remains on the props so the
  // capability can be re-enabled; these assert the buttons are not rendered.
  it('does not render the star (pick) flag button', () => {
    renderTray({ photos: [p('photo-X')] });
    expect(screen.queryByLabelText('candidates.flag.pick')).not.toBeInTheDocument();
  });

  it('does not render the block (reject) flag button', () => {
    renderTray({ photos: [p('photo-X')] });
    expect(screen.queryByLabelText('candidates.flag.reject')).not.toBeInTheDocument();
  });

  it('fires onDelete when delete button is clicked, and does NOT invalidate the thumb itself', () => {
    const onDelete = vi.fn();
    renderTray({ photos: [p('photo-X')], onDelete });
    const deleteButtons = screen.getAllByLabelText('common.delete');
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    expect(onDelete).toHaveBeenCalledWith('photo-X');
    // The epoch bump belongs to `useCompetitionSystem`, which owns EVERY
    // delete path (this button, the cleanup dialog, clear-all). Doing it here
    // too would leave the bulk paths uncovered while looking safe; the
    // behaviour itself is pinned in useCompetitionSystem.candidates.test.tsx.
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it('serialises a drag-payload with the tray protocol when a thumb starts dragging', () => {
    renderTray({ photos: [p('photo-X')] });
    // The draggable shell is the outer Box around the thumb. Its data-testid
    // is on the thumb image; the draggable parent is a few levels up.
    const thumbInner = screen.getByTestId('candidate-thumb-photo-X');
    const draggable = thumbInner.closest('[draggable="true"]') as HTMLElement;
    expect(draggable).not.toBeNull();

    const setData = vi.fn();
    const dataTransfer = {
      ...makeDataTransfer(),
      setData,
    } as unknown as DataTransfer;
    fireEvent.dragStart(draggable, { dataTransfer });

    // First call: the structured tray payload.
    const trayCall = setData.mock.calls.find(
      (call) => call[0] === DRAG_PAYLOAD_MIME,
    );
    expect(trayCall).toBeTruthy();
    expect(JSON.parse(trayCall![1])).toEqual({ kind: 'tray', photoId: 'photo-X' });
  });

  it('fires onSlotDroppedIn when a slot photo is dropped onto the populated tray', () => {
    const onSlotDroppedIn = vi.fn();
    renderTray({ photos: [p('photo-X')], onSlotDroppedIn });
    // The outer Paper carries the drop handler. Find it via the count header.
    const header = screen.getByText('candidates.title:{"count":1}');
    const outerPaper = header.closest('.MuiPaper-root') as HTMLElement;
    expect(outerPaper).not.toBeNull();
    fireEvent.drop(outerPaper, {
      dataTransfer: makeDataTransfer({
        [DRAG_PAYLOAD_MIME]: serializeDragPayload({
          kind: 'slot', setKey: 'set2', index: 1, photoId: 'slot-photo',
        }),
      }),
    });
    expect(onSlotDroppedIn).toHaveBeenCalledWith({ setKey: 'set2', photoId: 'slot-photo' });
  });
});

describe('CandidateTray — thumbnail tier (no editor mounted)', () => {
  it('renders plain <img> thumbs and NOT a single canvas', () => {
    // Structural guard for the whole point of the tier: mounting a
    // PhotoEditorApi per candidate is what this replaced, and an accidental
    // re-introduction shows up here as canvases appearing in the tray.
    const { container } = renderTray({ photos: [p('a'), p('b'), p('c')] });
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelectorAll('img')).toHaveLength(3);
  });

  it('points each <img> at the hook URL, undraggable and centre-cropped', () => {
    const { container } = renderTray({ photos: [p('photo-X')] });
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('src', 'thumb:photo-X');
    expect(img).toHaveAttribute('draggable', 'false');
    expect(img).toHaveAttribute('alt', 'photo-X.jpg');
    expect(img.style.objectFit).toBe('cover');
  });

  it('shows a skeleton and no image while the thumb is loading', () => {
    stubThumbView({ url: null, state: 'loading' });
    const { container } = renderTray({ photos: [p('photo-X')] });
    expect(container.querySelector('.MuiSkeleton-root')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders the full-resolution source image in the fallback state', () => {
    stubThumbView({ url: 'blob:photo-X', state: 'fallback' });
    const { container } = renderTray({ photos: [p('photo-X')] });
    expect(container.querySelector('img')).toHaveAttribute('src', 'blob:photo-X');
  });

  it('renders the missing-image caption when there are no bytes at all', () => {
    stubThumbView({ url: null, state: 'missing' });
    const { container } = renderTray({ photos: [p('photo-X')] });
    expect(screen.getByText('candidates.thumbMissing')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it.each([
    ['a resolved handle', testPhotosDir],
    ['null (storage unavailable)', null],
    ['undefined (still resolving)', undefined],
  ])('forwards photosDir to the hook verbatim: %s', (_label, dir) => {
    renderTray({ photos: [p('photo-X')], photosDir: dir as DirectoryHandle | null | undefined });
    expect(thumbHookMock).toHaveBeenCalled();
    expect(thumbHookMock.mock.calls[0][1]).toBe(dir);
  });
});

beforeEach(() => {
  // Reset the thumb hook to its default "ready" behaviour — individual tests
  // override it via stubThumbView and must not leak that into the next one.
  thumbHookMock.mockClear();
  thumbHookMock.mockImplementation((photo) => ({
    url: `thumb:${photo.id}`,
    state: 'ready' as const,
  }));
  invalidateMock.mockClear();
});
