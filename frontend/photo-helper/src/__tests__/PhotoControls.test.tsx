import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { PhotoControls } from '../components/PhotoControls';
import { makeCanvasState } from './support/testHelpers';
import type { ApiPhoto } from '../types/api';

// PhotoControls is now timer-free and speaks three channels: `onPreview` on
// every tick of a slider, `onCommit` once per interaction, `onUpdate` for the
// discrete actions. Which channel each control uses is the whole contract —
// a control that previews but never commits loses the edit, and one that
// commits per tick undoes the point of the change.
//
// The keyboard path is the deterministic pin: MUI's hidden range input handles
// ArrowLeft/Right itself and fires `onChange` + `onChangeCommitted` (except at
// the bounds, where it fires only the latter).

vi.mock('../contexts/I18nContext', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

afterEach(() => cleanup());

type CanvasState = ApiPhoto['canvasState'];
type Delta = Partial<CanvasState>;
type Mode = 'full' | 'sidebar' | 'sliders' | 'compact-left' | 'compact-right';

const CIRCLE = { x: 0, y: 0, radius: 30, color: 'red' as const, visible: true };

/**
 * Render PhotoControls the way the modal body does: a stateful owner that
 * folds previews (and immediate updates) back into the photo it hands down.
 * Without that, the component is frozen at its initial value and a repeated
 * "+" click could never produce 1, 2, 3.
 */
function renderControls(opts: {
  initial?: Delta;
  mode?: Mode;
  /** Omit the preview/commit props to exercise the backward-compatible fallback. */
  legacy?: boolean;
} = {}) {
  const onPreview = vi.fn();
  const onCommit = vi.fn();
  const onUpdate = vi.fn();

  function Harness() {
    const [canvasState, setCanvasState] = useState<CanvasState>(makeCanvasState(opts.initial));
    const apply = (delta: Delta) => setCanvasState(s => ({ ...s, ...delta }));
    return (
      <PhotoControls
        photo={{ canvasState }}
        label="A"
        mode={opts.mode ?? 'sliders'}
        onToggleOriginal={() => {}}
        onUpdate={(delta) => { onUpdate(delta); apply(delta); }}
        {...(opts.legacy ? {} : {
          onPreview: (delta: Delta) => { onPreview(delta); apply(delta); },
          onCommit: (delta: Delta) => { onCommit(delta); },
        })}
      />
    );
  }

  const utils = render(<Harness />);
  return { ...utils, onPreview, onCommit, onUpdate };
}

const ranges = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLInputElement>('input[type="range"]')];

/** Pick a slider by its numeric range, which is unique per control in a mode. */
function sliderByRange(container: HTMLElement, min: string, max: string): HTMLInputElement {
  const found = ranges(container).find(el => el.min === min && el.max === max);
  if (!found) throw new Error(`No slider with range ${min}..${max}`);
  return found;
}

/** The −/+ stepper buttons that flank a slider. */
function steppers(input: HTMLInputElement): { minus: HTMLElement; plus: HTMLElement } {
  const row = input.closest('.MuiSlider-root')?.parentElement;
  if (!row) throw new Error('Slider row not found');
  const buttons = [...row.querySelectorAll('button')];
  return { minus: buttons[0], plus: buttons[1] };
}

const buttonByText = (container: HTMLElement, text: string): HTMLElement => {
  const found = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === text);
  if (!found) throw new Error(`No button labelled "${text}"`);
  return found;
};

describe('PhotoControls — preview / commit / update channels', () => {
  it('a keyboard step previews then commits, and never writes through onUpdate', () => {
    const { container, onPreview, onCommit, onUpdate } = renderControls();
    const brightness = sliderByRange(container, '-100', '100');

    fireEvent.keyDown(brightness, { key: 'ArrowRight' });

    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledWith({ brightness: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ brightness: 1 });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('a keyboard step at the bound writes nothing (MUI still fires onChangeCommitted)', () => {
    const { container, onPreview, onCommit, onUpdate } = renderControls({ initial: { brightness: -100 } });
    const brightness = sliderByRange(container, '-100', '100');

    fireEvent.keyDown(brightness, { key: 'ArrowLeft' });

    expect(onPreview).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('a direct value change on the hidden input previews and then commits, once each', () => {
    // MUI treats a change on its hidden range input (assistive tech, or a
    // programmatic set) as a COMPLETE interaction: it fires onChange and
    // onChangeCommitted back to back. Pinned so the count can't silently
    // become two writes per keystroke.
    const { container, onPreview, onCommit, onUpdate } = renderControls();
    const brightness = sliderByRange(container, '-100', '100');

    fireEvent.change(brightness, { target: { value: '50' } });

    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledWith({ brightness: 50 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ brightness: 50 });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('zoom commits after a keyboard step (the regression the early-out used to swallow)', () => {
    // Before the fix, `handleScaleChange` returned early when the incoming
    // value matched `photo.canvasState.scale` — which, after the preview had
    // already been applied, was ALWAYS true for the commit.
    const { container, onPreview, onCommit } = renderControls();
    const zoom = sliderByRange(container, '1', '3');

    fireEvent.keyDown(zoom, { key: 'ArrowRight' });

    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview.mock.calls[0][0].scale).toBeCloseTo(1.05, 5);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0].scale).toBeCloseTo(1.05, 5);
  });

  it('the + stepper previews and commits once per click', () => {
    const { container, onPreview, onCommit, onUpdate } = renderControls();
    const { plus } = steppers(sliderByRange(container, '-100', '100'));

    fireEvent.click(plus);
    fireEvent.click(plus);
    fireEvent.click(plus);

    expect(onPreview.mock.calls.map(c => c[0])).toEqual([
      { brightness: 1 }, { brightness: 2 }, { brightness: 3 },
    ]);
    expect(onCommit.mock.calls.map(c => c[0])).toEqual([
      { brightness: 1 }, { brightness: 2 }, { brightness: 3 },
    ]);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('a quick-zoom preset commits immediately, and is a no-op at the current scale', () => {
    // The quick-zoom presets live in the panels that own the zoom control;
    // `sliders` mode has the zoom slider but not the preset row.
    const { container, onUpdate, onCommit } = renderControls({ mode: 'compact-left' });

    fireEvent.click(buttonByText(container, '150%'));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({ scale: 1.5 });
    expect(onCommit).not.toHaveBeenCalled();

    onUpdate.mockClear();
    // The harness applied scale 1.5; clicking 150% again changes nothing.
    fireEvent.click(buttonByText(container, '150%'));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('Reset all commits the full default state through onUpdate', () => {
    const { container, onUpdate, onCommit } = renderControls({ mode: 'compact-right' });

    fireEvent.click(buttonByText(container, 'controls.resetAll'));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0]).toMatchObject({
      position: { x: 0, y: 0 },
      scale: 1.0,
      brightness: 0,
      contrast: 1,
      sharpness: 0,
      whiteBalance: { temperature: 0, tint: 0, auto: false },
      labelPosition: 'bottom-left',
      circle: null,
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('circle colour and removal are immediate delta updates', () => {
    const { container, onUpdate } = renderControls({ mode: 'compact-right', initial: { circle: CIRCLE } });

    fireEvent.click(buttonByText(container, 'controls.circleMode.white'));
    expect(onUpdate).toHaveBeenCalledWith({ circle: { ...CIRCLE, color: 'white' } });

    onUpdate.mockClear();
    fireEvent.click(buttonByText(container, 'controls.circleMode.removeCircle'));
    expect(onUpdate).toHaveBeenCalledWith({ circle: null });
  });

  it('the label corner is an immediate delta update', () => {
    const { container, onUpdate, onCommit } = renderControls({ mode: 'compact-right' });

    fireEvent.click(buttonByText(container, '↖ A'));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({ labelPosition: 'top-left' });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('falls back to onUpdate for both channels when neither prop is given', () => {
    // Backward compatibility: an embedder that knows nothing about the
    // preview/commit split still gets today's write-on-every-tick behaviour.
    const { container, onUpdate } = renderControls({ legacy: true });
    const brightness = sliderByRange(container, '-100', '100');

    fireEvent.keyDown(brightness, { key: 'ArrowRight' });

    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(onUpdate.mock.calls.map(c => c[0])).toEqual([{ brightness: 1 }, { brightness: 1 }]);
  });

  it('renders every slider site in every mode (none lost its onCommit wiring)', () => {
    // 16 distinct `SliderWithControls` sites; `full` re-renders the two that
    // `sidebar` owns, hence 18 inputs across the five modes.
    const expected: Record<Mode, number> = {
      full: 8,
      sidebar: 2,
      sliders: 6,
      'compact-left': 1,
      'compact-right': 1,
    };
    for (const [mode, count] of Object.entries(expected) as [Mode, number][]) {
      const { container } = renderControls({ mode, initial: { circle: CIRCLE } });
      expect(ranges(container).length, `mode ${mode}`).toBe(count);
      cleanup();
    }
  });
});

describe('PhotoControls — pointer drag', () => {
  it('previews while dragging and commits once on release', () => {
    // jsdom has no layout, so the slider needs a box for MUI to map a client
    // X onto a value.
    const rect = { left: 0, top: 0, width: 100, height: 10, right: 100, bottom: 10, x: 0, y: 0, toJSON: () => ({}) };
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(rect as DOMRect);
    try {
      const { container, onPreview, onCommit } = renderControls();
      const brightness = sliderByRange(container, '-100', '100');
      const root = brightness.closest('.MuiSlider-root')!;

      fireEvent.mouseDown(root, { clientX: 75, clientY: 5, buttons: 1 });
      expect(onPreview).toHaveBeenCalled();
      expect(onCommit).not.toHaveBeenCalled();

      fireEvent.mouseUp(document, { clientX: 75, clientY: 5 });
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith({ brightness: 50 });
    } finally {
      spy.mockRestore();
    }
  });
});
