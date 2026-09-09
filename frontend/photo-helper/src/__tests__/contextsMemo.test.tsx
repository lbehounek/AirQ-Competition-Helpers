import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect, useState } from 'react';
import { render, act, cleanup, fireEvent, screen } from '@testing-library/react';
import { AspectRatioProvider, useAspectRatio, ASPECT_RATIO_OPTIONS } from '../contexts/AspectRatioContext';
import { LabelingProvider, useLabeling, LABELING_OPTIONS } from '../contexts/LabelingContext';
import { I18nProvider, useI18n } from '../contexts/I18nContext';
import { SUPPORTED_LOCALES } from '../locales';
import { LayoutModeProvider, useLayoutMode } from '../contexts/LayoutModeContext';

// The four contexts sit above every photo component. Before this WP each
// provider handed out a brand-new value object (and brand-new `t`,
// `generateLabel`, `getCanvasSize`, `layoutConfig`) on every one of ITS
// renders, which invalidated every downstream useMemo/useCallback and every
// React.memo in the tree. These tests pin the identities, and — just as
// importantly — pin that the values still CHANGE when they are supposed to.

/**
 * Wraps a provider in a parent that can be forced to re-render, re-creating
 * the `children` element each time (exactly what AppApi does on every state
 * change). Returns the button that forces the parent render.
 */
function Rerenderer({ children }: { children: React.ReactNode }) {
  const [tick, setTick] = useState(0);
  return (
    <>
      <button type="button" data-testid="force" onClick={() => setTick(t => t + 1)}>
        {tick}
      </button>
      {children}
    </>
  );
}

function forceParentRender() {
  act(() => { fireEvent.click(screen.getByTestId('force')); });
}

/** Collects the identities a consumer saw across renders. */
function makeProbe() {
  const seen = new Map<string, Set<unknown>>();
  return {
    record(fields: Record<string, unknown>) {
      for (const [key, value] of Object.entries(fields)) {
        const set = seen.get(key) ?? new Set();
        set.add(value);
        seen.set(key, set);
      }
    },
    identities(key: string) {
      return seen.get(key)?.size ?? 0;
    },
  };
}

afterEach(cleanup);

describe('AspectRatioContext memoization', () => {
  it('keeps the value object and every function stable across parent re-renders', () => {
    const probe = makeProbe();
    let ctx: ReturnType<typeof useAspectRatio> | null = null;

    function Consumer() {
      const value = useAspectRatio();
      // Recording happens in an effect throughout this file: the
      // react-compiler lint rules reject reassigning module-scope state during
      // render, and an effect with no dep array runs once per render anyway.
      useEffect(() => {
        ctx = value;
        probe.record({
          value,
          setAspectRatio: value.setAspectRatio,
          getCanvasSize: value.getCanvasSize,
          getPDFCellHeight: value.getPDFCellHeight,
          getCroppedCanvasSize: value.getCroppedCanvasSize,
        });
      });
      return null;
    }

    render(
      <Rerenderer>
        <AspectRatioProvider><Consumer /></AspectRatioProvider>
      </Rerenderer>,
    );

    forceParentRender();
    forceParentRender();

    for (const key of ['value', 'setAspectRatio', 'getCanvasSize', 'getPDFCellHeight', 'getCroppedCanvasSize']) {
      expect(probe.identities(key)).toBe(1);
    }
    // Still the real formula, delegated to utils/canvasSizing.
    // The provider's default ratio is 4:3 → 600×450.
    expect(ctx!.getCanvasSize(600)).toEqual({ width: 600, height: 450 });
  });

  it('publishes a NEW value (and transitions) when the ratio actually changes', () => {
    vi.useFakeTimers();
    const probe = makeProbe();
    let ctx: ReturnType<typeof useAspectRatio> | null = null;

    function Consumer() {
      const value = useAspectRatio();
      useEffect(() => { ctx = value; probe.record({ value }); });
      return <div data-testid="state" data-transitioning={String(value.isTransitioning)} data-ratio={value.currentRatio.id} />;
    }

    render(<AspectRatioProvider><Consumer /></AspectRatioProvider>);

    const sixteenNine = ASPECT_RATIO_OPTIONS.find(o => o.ratio === 16 / 9)!;
    act(() => { ctx!.setAspectRatio(sixteenNine); });

    expect(screen.getByTestId('state')).toHaveAttribute('data-transitioning', 'true');
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.getByTestId('state')).toHaveAttribute('data-transitioning', 'false');
    expect(screen.getByTestId('state')).toHaveAttribute('data-ratio', sixteenNine.id);
    expect(ctx!.getCanvasSize(600)).toEqual({ width: 600, height: 338 });
    expect(probe.identities('value')).toBeGreaterThan(1);

    vi.useRealTimers();
  });
});

describe('LabelingContext memoization', () => {
  it('keeps the value object, setLabeling and generateLabel stable across parent re-renders', () => {
    const probe = makeProbe();
    function Consumer() {
      const value = useLabeling();
      useEffect(() => {
        probe.record({ value, setLabeling: value.setLabeling, generateLabel: value.generateLabel });
      });
      return <div data-testid="label">{value.generateLabel(0)}</div>;
    }

    render(
      <Rerenderer>
        <LabelingProvider><Consumer /></LabelingProvider>
      </Rerenderer>,
    );

    forceParentRender();
    forceParentRender();

    expect(probe.identities('value')).toBe(1);
    expect(probe.identities('setLabeling')).toBe(1);
    expect(probe.identities('generateLabel')).toBe(1);
  });

  it('publishes a new value when the labeling changes, and stays locked in precision', () => {
    const probe = makeProbe();
    let ctx: ReturnType<typeof useLabeling> | null = null;
    function Consumer() {
      const value = useLabeling();
      useEffect(() => { ctx = value; probe.record({ value }); });
      return <div data-testid="label">{value.generateLabel(0)}</div>;
    }

    render(<LabelingProvider><Consumer /></LabelingProvider>);
    const before = screen.getByTestId('label').textContent;

    const other = LABELING_OPTIONS.find(o => o.id !== ctx!.currentLabeling.id)!;
    act(() => { ctx!.setLabeling(other); });

    if (ctx!.isLocked) {
      // Precision boot (a persisted precision discipline): the switch is a no-op.
      expect(screen.getByTestId('label').textContent).toBe(before);
      expect(ctx!.currentLabeling.id).toBe('numbers');
    } else {
      expect(screen.getByTestId('label').textContent).not.toBe(before);
      expect(probe.identities('value')).toBeGreaterThan(1);
    }
  });
});

describe('I18nContext memoization', () => {
  it('keeps the value object, t and setLocale stable across parent re-renders', async () => {
    const probe = makeProbe();
    function Consumer() {
      const value = useI18n();
      useEffect(() => { probe.record({ value, t: value.t, setLocale: value.setLocale }); });
      return <div data-testid="title">{value.t('app.title')}</div>;
    }

    render(
      <Rerenderer>
        <I18nProvider><Consumer /></I18nProvider>
      </Rerenderer>,
    );
    // The provider sets `translations` from an effect on mount; let that settle
    // so the identities we then compare are the steady-state ones.
    await act(async () => {});
    const titleBefore = screen.getByTestId('title').textContent;

    const valuesBefore = probe.identities('value');
    forceParentRender();
    forceParentRender();

    expect(probe.identities('value')).toBe(valuesBefore);
    expect(screen.getByTestId('title').textContent).toBe(titleBefore);
  });

  it('setLocale keeps ONE identity for the provider lifetime and still switches the locale', async () => {
    const probe = makeProbe();
    let ctx: ReturnType<typeof useI18n> | null = null;
    function Consumer() {
      const value = useI18n();
      useEffect(() => { ctx = value; probe.record({ setLocale: value.setLocale }); });
      return <div data-testid="locale">{value.locale}</div>;
    }

    render(<I18nProvider><Consumer /></I18nProvider>);
    await act(async () => {});

    // Pick whichever supported locale is NOT the current one — the codes are
    // 'cz'/'en', and an unsupported code is coerced back to DEFAULT_LOCALE.
    const target = SUPPORTED_LOCALES.map(l => l.code).find(code => code !== ctx!.locale)!;
    await act(async () => { await ctx!.setLocale(target); });

    expect(screen.getByTestId('locale').textContent).toBe(target);
    // setLocale reads nothing from the render scope, so its identity is fixed.
    expect(probe.identities('setLocale')).toBe(1);
  });
});

describe('LayoutModeContext memoization', () => {
  beforeEach(() => {
    // The provider's initial mode reads localStorage; keep cases independent.
    try { window.localStorage.clear(); } catch { /* jsdom without storage */ }
  });

  it('keeps the value object, layoutConfig and the functions stable across parent re-renders', () => {
    const probe = makeProbe();
    function Consumer() {
      const value = useLayoutMode();
      useEffect(() => {
        probe.record({
          value,
          layoutConfig: value.layoutConfig,
          setLayoutMode: value.setLayoutMode,
          getGridDimensions: value.getGridDimensions,
        });
      });
      return null;
    }

    render(
      <Rerenderer>
        <LayoutModeProvider><Consumer /></LayoutModeProvider>
      </Rerenderer>,
    );

    forceParentRender();
    forceParentRender();

    for (const key of ['value', 'layoutConfig', 'setLayoutMode', 'getGridDimensions']) {
      expect(probe.identities(key)).toBe(1);
    }
  });

  it('publishes a new value and a new layoutConfig when the mode changes', () => {
    const probe = makeProbe();
    let ctx: ReturnType<typeof useLayoutMode> | null = null;
    function Consumer() {
      const value = useLayoutMode();
      useEffect(() => { ctx = value; probe.record({ value, layoutConfig: value.layoutConfig }); });
      return <div data-testid="mode">{value.layoutMode}</div>;
    }

    render(<LayoutModeProvider><Consumer /></LayoutModeProvider>);
    const startMode = ctx!.layoutMode;
    const target = startMode === 'portrait' ? 'landscape' : 'portrait';

    act(() => { ctx!.setLayoutMode(target); });

    expect(screen.getByTestId('mode').textContent).toBe(target);
    expect(ctx!.layoutConfig.mode).toBe(target);
    expect(probe.identities('value')).toBeGreaterThan(1);
    expect(probe.identities('layoutConfig')).toBeGreaterThan(1);
  });
});
