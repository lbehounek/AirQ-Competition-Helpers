import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { PhotoGridApi } from '../components/PhotoGridApi';
import { serializeDragPayload, DRAG_PAYLOAD_MIME } from '../utils/dragPayload';
import { makeCanvasState } from './support/testHelpers';
import type { ApiPhoto, ApiPhotoSet } from '../types/api';

// The grid is where "editing one photo redraws twenty canvases" was actually
// paid for. These tests count RENDERS of the (mocked) per-slot editor, which is
// the proxy for a redraw: PhotoEditorApi.redraw.test.tsx already pins that a
// render with unchanged props does not draw, and a render with a changed photo
// does.

/** Per-photo-id render counters + the latest props each mock editor was given. */
const editorRenders = new Map<string, number>();
const editorProps = new Map<string, { onUpdate: (canvasState: ApiPhoto['canvasState']) => void }>();

vi.mock('../components/PhotoEditorApi', () => ({
  // Memoized on purpose: the real component is too, so a mock that always
  // re-rendered would make every assertion below meaningless.
  PhotoEditorApi: React.memo(function MockEditor(props: {
    photo: ApiPhoto;
    label: string;
    onUpdate: (canvasState: ApiPhoto['canvasState']) => void;
  }) {
    editorRenders.set(props.photo.id, (editorRenders.get(props.photo.id) ?? 0) + 1);
    editorProps.set(props.photo.id, { onUpdate: props.onUpdate });
    return <div data-testid={`editor-${props.photo.id}`}>{props.label}</div>;
  }),
}));

const preloadImages = vi.fn(async () => {});
vi.mock('../utils/imageCache', () => ({
  getImageCache: () => ({ preloadImages }),
}));

// Configurable per case: `isAvailable` flips the empty slot from the dropzone
// path (where a missing handler is unobservable — the stable wrapper makes the
// call a no-op) to the Electron picker path, where `canDropFiles` is the only
// thing standing between a slot with no handler and an open file dialog.
const electronImport = vi.hoisted(() => ({
  isAvailable: false,
  isImporting: false,
  importError: null as string | null,
  pickPhotos: vi.fn(async () => {}),
  clearImportError: vi.fn(),
}));
vi.mock('../hooks/useElectronPhotoImport', () => ({
  useElectronPhotoImport: () => electronImport,
}));

vi.mock('../contexts/I18nContext', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

// Frozen context values so the ONLY thing that can change a grid prop is the
// test itself — and so `useLayoutMode` doubles as the render counter for
// PhotoGridApi's inner (unmemoized) implementation, which nothing else calls.
const RATIO = { currentRatio: { ratio: 4 / 3, cssRatio: '4 / 3' }, isTransitioning: false };
vi.mock('../contexts/AspectRatioContext', () => ({
  useAspectRatio: () => RATIO,
}));

const LABELING = { generateLabel: (index: number, offset = 0) => String.fromCharCode(65 + index + offset) };
vi.mock('../contexts/LabelingContext', () => ({
  useLabeling: () => LABELING,
}));

let gridImplRenders = 0;
const LAYOUT = {
  layoutMode: 'landscape' as const,
  layoutConfig: { mode: 'landscape' as const, slots: 9, columns: 3, maxPhotosPerSet: 9 },
};
vi.mock('../contexts/LayoutModeContext', () => ({
  useLayoutMode: () => {
    gridImplRenders += 1;
    return LAYOUT;
  },
}));

function photo(id: string, overrides: Partial<ApiPhoto['canvasState']> = {}): ApiPhoto {
  return {
    id,
    sessionId: 'sess-1',
    url: `blob:${id}`,
    filename: `${id}.jpg`,
    canvasState: makeCanvasState(overrides),
    label: '',
  };
}

function set(photos: ApiPhoto[]): ApiPhotoSet {
  return { title: 'Set 1', photos };
}

/**
 * Map-backed DataTransfer shim — jsdom does not implement the constructor.
 * `types` is derived from the keys so `types.includes(MIME)` works.
 */
function makeDataTransfer(initial: Record<string, string> = {}, files: File[] = []): DataTransfer {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    types: [...store.keys()],
    files: files as unknown as FileList,
    items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    getData: (mime: string) => store.get(mime) ?? '',
    setData: (mime: string, value: string) => { store.set(mime, value); },
    effectAllowed: 'move',
    dropEffect: 'move',
  } as unknown as DataTransfer;
}

type GridProps = React.ComponentProps<typeof PhotoGridApi>;

function baseProps(overrides: Partial<GridProps> = {}): GridProps {
  return {
    photoSet: set([photo('a'), photo('b'), photo('c')]),
    setKey: 'set1',
    onPhotoUpdate: vi.fn(),
    onPhotoRemove: vi.fn(),
    onPhotoClick: vi.fn(),
    onPhotoMove: vi.fn(),
    onCandidateDropped: vi.fn(),
    onCrossSetDropRejected: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  editorRenders.clear();
  editorProps.clear();
  preloadImages.mockClear();
  gridImplRenders = 0;
  // The Electron bridge is off by default — only the two picker cases turn it on.
  electronImport.isAvailable = false;
  electronImport.isImporting = false;
  electronImport.importError = null;
  electronImport.pickPhotos.mockClear();
  electronImport.clearImportError.mockClear();
});

afterEach(cleanup);

describe('PhotoGridApi per-slot memoization', () => {
  it('re-renders only the edited photo, even when every callback prop is a fresh arrow', () => {
    const props = baseProps();
    const { rerender } = render(<PhotoGridApi {...props} />);

    expect(editorRenders.get('a')).toBe(1);
    expect(editorRenders.get('b')).toBe(1);
    expect(editorRenders.get('c')).toBe(1);

    // Exactly what an edit produces: a NEW photos array where only 'a' is a new
    // object, plus new inline handlers from a parent that has not been migrated.
    const edited = props.photoSet.photos.map(p =>
      p.id === 'a' ? { ...p, canvasState: { ...p.canvasState, brightness: 10 } } : p,
    );
    rerender(
      <PhotoGridApi
        {...baseProps({ photoSet: set(edited) })}
      />,
    );

    expect(editorRenders.get('a')).toBe(2);
    expect(editorRenders.get('b')).toBe(1);
    expect(editorRenders.get('c')).toBe(1);
  });

  it('a drag-over flips only the hovered slot, not the editors', () => {
    const props = baseProps();
    const { container } = render(<PhotoGridApi {...props} />);
    const before = new Map(editorRenders);

    const slots = container.querySelectorAll('.MuiPaper-root');
    fireEvent.dragOver(slots[1], { dataTransfer: makeDataTransfer() });

    // The hovered Paper restyles, but no editor's props changed.
    for (const [id, count] of before) {
      expect(editorRenders.get(id)).toBe(count);
    }
  });

  it('always calls the LATEST onPhotoUpdate through the stable wrapper', () => {
    const first = vi.fn();
    const { rerender } = render(<PhotoGridApi {...baseProps({ onPhotoUpdate: first })} />);

    const second = vi.fn();
    rerender(<PhotoGridApi {...baseProps({ onPhotoUpdate: second })} />);

    const canvasState = makeCanvasState({ brightness: 3 });
    act(() => { editorProps.get('a')!.onUpdate(canvasState); });

    expect(second).toHaveBeenCalledWith('a', canvasState);
    expect(first).not.toHaveBeenCalled();
  });
});

describe('PhotoGridApi preloading', () => {
  it('preloads once per real change to the photo list, not per edit', () => {
    const photos = [photo('a'), photo('b')];
    const props = baseProps({ photoSet: set(photos) });
    const { rerender } = render(<PhotoGridApi {...props} />);

    expect(preloadImages).toHaveBeenCalledTimes(1);

    // 1. Optimistic edit render: new array, one new photo object, same ids/urls.
    const edited = photos.map(p => (p.id === 'a' ? { ...p, canvasState: { ...p.canvasState, brightness: 4 } } : p));
    rerender(<PhotoGridApi {...baseProps({ photoSet: set(edited) })} />);
    expect(preloadImages).toHaveBeenCalledTimes(1);

    // 2. The post-persistence render: another fresh array of the same objects.
    rerender(<PhotoGridApi {...baseProps({ photoSet: set([...edited]) })} />);
    expect(preloadImages).toHaveBeenCalledTimes(1);

    // 3. A photo is added → the list really changed.
    rerender(<PhotoGridApi {...baseProps({ photoSet: set([...edited, photo('c')]) })} />);
    expect(preloadImages).toHaveBeenCalledTimes(2);

    // 4. A url is re-blobbed (mode switch revokes and recreates them).
    const reblobbed = edited.map(p => (p.id === 'b' ? { ...p, url: 'blob:b-2' } : p));
    rerender(<PhotoGridApi {...baseProps({ photoSet: set([...reblobbed, photo('c')]) })} />);
    expect(preloadImages).toHaveBeenCalledTimes(3);
  });
});

describe('PhotoGridApi preserved behaviours', () => {
  it('clicking a photo opens it', () => {
    const onPhotoClick = vi.fn();
    const props = baseProps({ onPhotoClick });
    const { getByTestId } = render(<PhotoGridApi {...props} />);

    fireEvent.click(getByTestId('editor-b').parentElement!);

    expect(onPhotoClick).toHaveBeenCalledWith(props.photoSet.photos[1]);
  });

  it('the delete button removes by id and does not also open the editor', () => {
    const onPhotoRemove = vi.fn();
    const onPhotoClick = vi.fn();
    const { getAllByLabelText } = render(<PhotoGridApi {...baseProps({ onPhotoRemove, onPhotoClick })} />);

    fireEvent.click(getAllByLabelText('photo.deleteTooltip')[2]);

    expect(onPhotoRemove).toHaveBeenCalledWith('c');
    expect(onPhotoClick).not.toHaveBeenCalled();
  });

  it('a structured tray payload promotes the candidate to the dropped slot', () => {
    const onCandidateDropped = vi.fn();
    const { container } = render(<PhotoGridApi {...baseProps({ onCandidateDropped })} />);

    const dataTransfer = makeDataTransfer({
      [DRAG_PAYLOAD_MIME]: serializeDragPayload({ kind: 'tray', photoId: 'cand-9' }),
    });
    fireEvent.drop(container.querySelectorAll('.MuiPaper-root')[4], { dataTransfer });

    expect(onCandidateDropped).toHaveBeenCalledWith('cand-9', 4);
  });

  it('a text/plain payload reorders within the grid', () => {
    const onPhotoMove = vi.fn();
    const { container } = render(<PhotoGridApi {...baseProps({ onPhotoMove })} />);

    fireEvent.drop(container.querySelectorAll('.MuiPaper-root')[2], {
      dataTransfer: makeDataTransfer({ 'text/plain': '0' }),
    });

    expect(onPhotoMove).toHaveBeenCalledWith(0, 2);
  });

  it('the "No photo" affordance appears only on the first empty turning-point slot', () => {
    const onAddPlaceholder = vi.fn();
    const customLabels = ['SP', 'TP1', 'FP'];
    const { getAllByText } = render(
      <PhotoGridApi {...baseProps({ onAddPlaceholder, customLabels })} />,
    );

    const buttons = getAllByText('photo.addNoPhoto');
    expect(buttons).toHaveLength(1);

    fireEvent.click(buttons[0]);
    // Three photos → the first empty slot is index 3.
    expect(onAddPlaceholder).toHaveBeenCalledWith(3);
  });

  it('does not show the "No photo" affordance in track mode (no customLabels)', () => {
    const { queryByText } = render(<PhotoGridApi {...baseProps({ onAddPlaceholder: vi.fn() })} />);
    expect(queryByText('photo.addNoPhoto')).toBeNull();
  });

  it('an empty slot forwards a valid file drop only when the parent supplied a handler', async () => {
    // The `canDropFiles` boolean replaces the old `onFilesDropped && …` checks,
    // which a never-undefined stable wrapper would have made always-true.
    const onFilesDropped = vi.fn();
    const { container } = render(
      <PhotoGridApi {...baseProps({ photoSet: set([photo('a')]), onFilesDropped })} />,
    );
    const dropzone = container.querySelectorAll('.MuiPaper-root')[1].firstElementChild!;
    const file = new File(['x'], 'x.jpg', { type: 'image/jpeg' });

    await act(async () => {
      fireEvent.drop(dropzone, { dataTransfer: makeDataTransfer({}, [file]) });
    });

    expect(onFilesDropped).toHaveBeenCalledTimes(1);
    expect(onFilesDropped.mock.calls[0][0][0].name).toBe('x.jpg');
  });

  it('an empty slot opens no picker when the parent supplied no handler', async () => {
    // `canDropFiles` exists because `onSlotFilesDropped` is a useStableCallback
    // wrapper and therefore NEVER undefined: an `onFilesDropped &&` presence
    // test would read as "always true". Through the dropzone that regression is
    // invisible (the wrapper's `ref.current?.()` is a no-op); through the
    // desktop picker it opens a file dialog for a slot that cannot accept the
    // result. So assert on the picker.
    electronImport.isAvailable = true;
    const props = baseProps({ photoSet: set([photo('a')]) });
    delete (props as Partial<GridProps>).onFilesDropped;
    const { container } = render(<PhotoGridApi {...props} />);
    const dropzone = container.querySelectorAll('.MuiPaper-root')[1].firstElementChild!;

    await act(async () => { fireEvent.click(dropzone); });

    expect(electronImport.pickPhotos).not.toHaveBeenCalled();
  });

  it('an empty slot DOES open the picker when a handler is supplied', async () => {
    // The positive twin — without it the case above would also pass if the
    // picker were wired to nothing at all.
    electronImport.isAvailable = true;
    const onFilesDropped = vi.fn();
    const { container } = render(
      <PhotoGridApi {...baseProps({ photoSet: set([photo('a')]), onFilesDropped })} />,
    );
    const dropzone = container.querySelectorAll('.MuiPaper-root')[1].firstElementChild!;

    await act(async () => { fireEvent.click(dropzone); });

    expect(electronImport.pickPhotos).toHaveBeenCalledTimes(1);
    // The picker is handed the STABLE wrapper, not the raw prop; invoking it
    // has to reach the caller's spy.
    const [, forwarded] = electronImport.pickPhotos.mock.calls[0] as unknown as [number, (files: File[]) => void];
    forwarded([new File(['x'], 'x.jpg', { type: 'image/jpeg' })]);
    expect(onFilesDropped).toHaveBeenCalledTimes(1);
  });
});

describe('PhotoGridApi memo comparator', () => {
  it('skips the render when customLabels is a fresh array of the SAME strings', () => {
    const shared = baseProps({ customLabels: ['SP', 'TP1', 'FP'] });
    const { rerender } = render(<PhotoGridApi {...shared} />);
    const rendersAfterMount = gridImplRenders;

    // Everything identical except a brand-new labels array — exactly what
    // TurningPointLayout produced before it memoized `generateTurningPointLabels`.
    rerender(<PhotoGridApi {...shared} customLabels={['SP', 'TP1', 'FP']} />);
    expect(gridImplRenders).toBe(rendersAfterMount);
  });

  it('re-renders when a label actually changes', () => {
    const shared = baseProps({ customLabels: ['SP', 'TP1', 'FP'] });
    const { rerender } = render(<PhotoGridApi {...shared} />);
    const rendersAfterMount = gridImplRenders;

    rerender(<PhotoGridApi {...shared} customLabels={['SP', 'TP2', 'FP']} />);
    expect(gridImplRenders).toBeGreaterThan(rendersAfterMount);
  });

  it('re-renders when any non-label prop changes identity', () => {
    const shared = baseProps({ customLabels: ['SP', 'TP1', 'FP'] });
    const { rerender } = render(<PhotoGridApi {...shared} />);
    const rendersAfterMount = gridImplRenders;

    rerender(<PhotoGridApi {...shared} onPhotoUpdate={vi.fn()} />);
    expect(gridImplRenders).toBeGreaterThan(rendersAfterMount);
  });
});
