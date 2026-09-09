import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { PhotoEditorModalBody } from '../components/PhotoEditorModalBody';
import { makeCanvasState } from './support/testHelpers';
import type { ApiPhoto } from '../types/api';
import type { CanvasSetting, CanvasState } from '../utils/canvasStatePatch';

// The modal body is where a slider drag stops being a per-frame re-render of
// the whole app: it holds the live PREVIEW locally and lets exactly one
// debounced COMMIT out to the parent. The properties pinned here are the ones
// a refactor would quietly break — preview never persists, commit persists
// once, an immediate action folds the pending delta in rather than dropping
// it, both panels share ONE debounce, and every teardown path commits against
// the photo the edit was made on.

vi.mock('../contexts/I18nContext', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

// Both children are stubbed: the real ones drag in WebGL, canvas, the image
// cache and the aspect-ratio context, none of which this component's contract
// depends on. The stubs expose the props as buttons and render the canvas
// state they were handed, which is exactly what the assertions need.
vi.mock('../components/PhotoControls', () => ({
  PhotoControls: ({ photo, mode, onPreview, onCommit, onUpdate, onApplyToAll }: {
    photo: { canvasState: CanvasState };
    mode?: string;
    onPreview?: (d: Partial<CanvasState>) => void;
    onCommit?: (d: Partial<CanvasState>) => void;
    onUpdate: (d: Partial<CanvasState>) => void;
    onApplyToAll?: (setting: CanvasSetting, value: number) => void;
  }) => (
    <div data-testid={`controls-${mode}`} data-brightness={String(photo.canvasState.brightness)} data-contrast={String(photo.canvasState.contrast)}>
      <button data-testid={`preview-${mode}`} onClick={() => onPreview?.({ brightness: 42 })}>preview</button>
      {/* A second, distinct preview value — a real slider emits one per
          pointermove, so "commit 42, then keep dragging to 99" needs two. */}
      <button data-testid={`preview2-${mode}`} onClick={() => onPreview?.({ brightness: 99 })}>preview again</button>
      <button data-testid={`commit-${mode}`} onClick={() => onCommit?.({ brightness: 42 })}>commit</button>
      <button data-testid={`commit-contrast-${mode}`} onClick={() => onCommit?.({ contrast: 1.5 })}>commit contrast</button>
      <button data-testid={`reset-${mode}`} onClick={() => onUpdate({ brightness: 0, contrast: 1 })}>reset</button>
      {/* A discrete action carrying ONE field, so a test can check what happens
          to a different field that is only along for the ride (the pending
          debounced payload `commitNow` folds in). */}
      <button data-testid={`reset-contrast-${mode}`} onClick={() => onUpdate({ contrast: 1 })}>reset contrast</button>
      <button data-testid={`applyall-${mode}`} onClick={() => onApplyToAll?.('brightness', 42)}>apply to all</button>
    </div>
  ),
}));

vi.mock('../components/PhotoEditorApi', () => ({
  PhotoEditorApi: ({ photo, onUpdate }: {
    photo: { canvasState: CanvasState };
    onUpdate: (state: CanvasState) => void;
  }) => (
    <div
      data-testid="editor"
      data-brightness={String(photo.canvasState.brightness)}
      data-position={JSON.stringify(photo.canvasState.position)}
    >
      <button
        data-testid="editor-pan"
        onClick={() => onUpdate({ ...photo.canvasState, position: { x: 5, y: 6 } })}
      >
        pan
      </button>
    </div>
  ),
}));

const DEBOUNCE = 150;

function makePhoto(id: string, overrides: Partial<CanvasState> = {}): ApiPhoto {
  return {
    id,
    sessionId: 'sess-1',
    url: 'blob:test/1',
    filename: `${id}.jpg`,
    canvasState: makeCanvasState(overrides),
    label: '',
  };
}

/** Typed spies — a bare `vi.fn()` is not assignable to a multi-arg prop type. */
const makeUpdateSpy = () =>
  vi.fn((_setKey: 'set1' | 'set2' | 'candidates', _photoId: string, _delta: Partial<CanvasState>) => {});
const makeApplyAllSpy = () => vi.fn((_setting: CanvasSetting, _value: number) => {});

type Overrides = {
  photo?: ApiPhoto;
  onUpdate?: ReturnType<typeof makeUpdateSpy>;
  applySettingToAll?: ReturnType<typeof makeApplyAllSpy>;
};

function renderBody(overrides: Overrides = {}) {
  const onUpdate = overrides.onUpdate ?? makeUpdateSpy();
  const photo = overrides.photo ?? makePhoto('photo-1');
  const props = {
    selected: { photo, setKey: 'set1' as const, label: 'A' },
    sessionMode: 'track' as const,
    onUpdate,
    onClose: vi.fn(),
    modalIndex: 0,
    modalCount: 3,
    canPrev: false,
    canNext: true,
    onNavigate: vi.fn(),
    onStartTour: vi.fn(),
    applySettingToAll: overrides.applySettingToAll,
  };
  const utils = render(<PhotoEditorModalBody {...props} />);
  return { ...utils, onUpdate, props };
}

const advance = (ms = DEBOUNCE) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('PhotoEditorModalBody', () => {
  it('a preview reaches both panels and the canvas, and persists nothing', () => {
    const { onUpdate } = renderBody();

    fireEvent.click(screen.getByTestId('preview-sliders'));

    expect(screen.getByTestId('editor')).toHaveAttribute('data-brightness', '42');
    expect(screen.getByTestId('controls-sliders')).toHaveAttribute('data-brightness', '42');
    expect(screen.getByTestId('controls-compact-right')).toHaveAttribute('data-brightness', '42');

    advance();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('a commit persists once after the debounce and retires the overlay', () => {
    const { onUpdate } = renderBody();

    fireEvent.click(screen.getByTestId('preview-sliders'));
    fireEvent.click(screen.getByTestId('commit-sliders'));
    expect(onUpdate).not.toHaveBeenCalled();

    advance();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith('set1', 'photo-1', { brightness: 42 });
    // Overlay gone: the stubs show the prop value again (the parent owns the
    // committed state now, and this test's parent never applies it).
    expect(screen.getByTestId('editor')).toHaveAttribute('data-brightness', '0');
  });

  it('a commit firing mid-drag keeps the live preview', () => {
    // A MUI slider previews per pointermove but commits only on release, so
    // re-grabbing it inside the 150 ms window does NOT reset the timer. The
    // commit must retire only the value it carried, never the newer live one.
    const { onUpdate } = renderBody();

    fireEvent.click(screen.getByTestId('preview-sliders'));   // drag to 42
    fireEvent.click(screen.getByTestId('commit-sliders'));    // release  → t+0
    advance(100);                                             // timer still pending
    fireEvent.click(screen.getByTestId('preview2-sliders'));  // re-grab, drag to 99
    expect(screen.getByTestId('editor')).toHaveAttribute('data-brightness', '99');

    advance(60);                                              // the t+150 timer fires
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith('set1', 'photo-1', { brightness: 42 });
    // The in-progress value survives: no snap back to the committed 42 (or, as
    // in this harness where the parent never applies the commit, to the prop 0).
    expect(screen.getByTestId('editor')).toHaveAttribute('data-brightness', '99');
    expect(screen.getByTestId('controls-sliders')).toHaveAttribute('data-brightness', '99');
  });

  it('a discrete action clears an overlay that disagrees with it', () => {
    // Regression: the mid-drag rule above (retire only where the overlay still
    // holds the committed value) is wrong for a DISCRETE action, which sets a
    // value rather than continuing a gesture. Reset to 0 while the overlay held
    // 42 used to leave 42 in the overlay for the life of the modal — both
    // panels and the canvas kept showing it, and the next pan committed that
    // stale 42 back to storage, silently undoing the reset.
    const { onUpdate } = renderBody();

    fireEvent.click(screen.getByTestId('preview-sliders'));   // drag to 42
    expect(screen.getByTestId('editor')).toHaveAttribute('data-brightness', '42');

    fireEvent.click(screen.getByTestId('reset-sliders'));     // ↻ → commits 0

    expect(onUpdate).toHaveBeenCalledWith('set1', 'photo-1', { brightness: 0, contrast: 1 });
    // Overlay retired: the stubs fall back to the prop, which this harness's
    // parent never updates — so 0, the reset value, not the stale 42.
    expect(screen.getByTestId('editor')).toHaveAttribute('data-brightness', '0');
    expect(screen.getByTestId('controls-sliders')).toHaveAttribute('data-brightness', '0');
    expect(screen.getByTestId('controls-compact-right')).toHaveAttribute('data-brightness', '0');

    // And it stays gone: a later commit must not resurrect it.
    fireEvent.click(screen.getByTestId('editor-pan'));
    advance();
    const [, , delta] = onUpdate.mock.calls[onUpdate.mock.calls.length - 1];
    expect(delta.brightness).toBe(0);
  });

  it('a discrete action keeps a live overlay for a field it did not set', () => {
    // The authoritative rule covers only the discrete action's OWN keys. The
    // pending debounced payload it folds in alongside them must still follow
    // the mid-drag rule, or clicking one control would snap back another one
    // the user is still dragging.
    const { onUpdate } = renderBody();

    fireEvent.click(screen.getByTestId('preview-sliders'));       // drag to 42
    fireEvent.click(screen.getByTestId('commit-sliders'));        // release → pending {brightness: 42}
    fireEvent.click(screen.getByTestId('preview2-sliders'));      // re-grab, drag on to 99
    fireEvent.click(screen.getByTestId('reset-contrast-sliders')); // discrete, carries contrast only

    // The commit folds the pending brightness in...
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith('set1', 'photo-1', { brightness: 42, contrast: 1 });
    // ...but brightness was not the action's own field, so the live 99 stays.
    expect(screen.getByTestId('editor')).toHaveAttribute('data-brightness', '99');
    expect(screen.getByTestId('controls-sliders')).toHaveAttribute('data-brightness', '99');
  });

  it('an editor snapshot previews instantly and commits merged over what was pending', () => {
    const { onUpdate } = renderBody();

    fireEvent.click(screen.getByTestId('preview-sliders'));
    fireEvent.click(screen.getByTestId('commit-sliders'));
    fireEvent.click(screen.getByTestId('editor-pan'));

    // No snap-back mid-drag: the editor sees its own new position at once.
    expect(screen.getByTestId('editor')).toHaveAttribute('data-position', JSON.stringify({ x: 5, y: 6 }));

    advance();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [, , delta] = onUpdate.mock.calls[0];
    expect(delta.position).toEqual({ x: 5, y: 6 });
    // The snapshot was taken from the PREVIEWED photo, so the pending slider
    // value rides along instead of being reverted.
    expect(delta.brightness).toBe(42);
  });

  it('an immediate action folds the pending delta in and fires at once', () => {
    const { onUpdate } = renderBody();

    fireEvent.click(screen.getByTestId('preview-sliders'));
    fireEvent.click(screen.getByTestId('commit-sliders'));
    fireEvent.click(screen.getByTestId('reset-sliders'));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    // Reset wins on the field they share; nothing is dropped.
    expect(onUpdate).toHaveBeenCalledWith('set1', 'photo-1', { brightness: 0, contrast: 1 });

    advance();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('flushes the pending delta BEFORE an apply-to-all fan-out', () => {
    const applySettingToAll = makeApplyAllSpy();
    const { onUpdate } = renderBody({ applySettingToAll });

    fireEvent.click(screen.getByTestId('commit-sliders'));
    fireEvent.click(screen.getByTestId('applyall-sliders'));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(applySettingToAll).toHaveBeenCalledWith('brightness', 42);
    // The fan-out reads the hook's current competition synchronously, so our
    // commit has to have been published first.
    expect(onUpdate.mock.invocationCallOrder[0])
      .toBeLessThan(applySettingToAll.mock.invocationCallOrder[0]);
  });

  it('unmounting with a pending delta commits it once, against the original photo', () => {
    const { onUpdate, unmount } = renderBody();

    fireEvent.click(screen.getByTestId('commit-sliders'));
    act(() => { unmount(); });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith('set1', 'photo-1', { brightness: 42 });

    advance();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('paging to another photo commits the pending delta against the OLD photo', () => {
    const onUpdate = makeUpdateSpy();
    const first = makePhoto('photo-1');
    const second = makePhoto('photo-2', { brightness: 7 });
    const props = {
      sessionMode: 'track' as const,
      onUpdate,
      onClose: vi.fn(),
      modalIndex: 0,
      modalCount: 3,
      canPrev: false,
      canNext: true,
      onNavigate: vi.fn(),
      onStartTour: vi.fn(),
    };
    const { rerender } = render(
      <PhotoEditorModalBody {...props} selected={{ photo: first, setKey: 'set1', label: 'A' }} />,
    );

    fireEvent.click(screen.getByTestId('preview-sliders'));
    fireEvent.click(screen.getByTestId('commit-sliders'));

    act(() => {
      rerender(
        <PhotoEditorModalBody {...props} selected={{ photo: second, setKey: 'set1', label: 'B' }} />,
      );
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith('set1', 'photo-1', { brightness: 42 });
    // The stale overlay is ignored on sight: the new photo shows its own value.
    expect(screen.getByTestId('editor')).toHaveAttribute('data-brightness', '7');
  });

  it('pagehide commits what is pending', () => {
    const { onUpdate } = renderBody();

    fireEvent.click(screen.getByTestId('commit-sliders'));
    act(() => { window.dispatchEvent(new Event('pagehide')); });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith('set1', 'photo-1', { brightness: 42 });
  });

  it('the two panels share ONE debounce, so their deltas merge into one commit', () => {
    const { onUpdate } = renderBody();

    fireEvent.click(screen.getByTestId('commit-sliders'));
    fireEvent.click(screen.getByTestId('commit-contrast-compact-right'));

    advance();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith('set1', 'photo-1', { brightness: 42, contrast: 1.5 });
  });
});
