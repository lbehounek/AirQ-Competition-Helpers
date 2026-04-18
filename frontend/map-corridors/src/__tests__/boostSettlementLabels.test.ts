import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { boostSettlementLabels } from '../utils/mapCapture'

/**
 * Unit tests for the A4-print label-boost helper. The real helper runs against
 * a Mapbox GL `Map`, but its API surface is tiny — we build a minimal mock so
 * we can pin the silent-failure contract that the PR #42 review flagged.
 */
type MockLayer = { id: string; type: 'symbol' | 'raster' | 'line'; [k: string]: unknown }

function makeMockMap(layers: MockLayer[], layoutValues: Record<string, unknown> = {}, opts: {
  throwSetLayout?: (id: string) => boolean
  throwSetPaint?: (id: string) => boolean
} = {}) {
  const setLayout = vi.fn((id: string, prop: string, value: unknown) => {
    if (opts.throwSetLayout?.(id)) throw new Error(`setLayoutProperty(${id}, ${prop}) threw`)
    // no-op otherwise
    void value
  })
  const setPaint = vi.fn((id: string, prop: string, value: unknown) => {
    if (opts.throwSetPaint?.(id)) throw new Error(`setPaintProperty(${id}, ${prop}) threw`)
    void value
  })
  const getLayout = vi.fn((id: string, prop: string) => {
    return layoutValues[`${id}.${prop}`]
  })
  return {
    map: {
      getStyle: () => ({ layers }),
      getLayoutProperty: getLayout,
      setLayoutProperty: setLayout,
      setPaintProperty: setPaint,
    } as any,
    setLayout,
    setPaint,
    getLayout,
  }
}

describe('boostSettlementLabels', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('boosts matching symbol layers (settlement, place-label, town-label, city-label)', () => {
    const { map, setLayout, setPaint } = makeMockMap(
      [
        { id: 'settlement-minor-label', type: 'symbol' },
        { id: 'place-label-major', type: 'symbol' },
        { id: 'town-label-small', type: 'symbol' },
        { id: 'city-label-capital', type: 'symbol' },
        { id: 'place_label_legacy', type: 'symbol' },
      ],
      {
        'settlement-minor-label.text-size': 12,
        'place-label-major.text-size': 14,
        'town-label-small.text-size': 10,
        'city-label-capital.text-size': 16,
        'place_label_legacy.text-size': 11,
      }
    )
    boostSettlementLabels(map)
    expect(setLayout).toHaveBeenCalledTimes(5)
    expect(setLayout).toHaveBeenCalledWith('settlement-minor-label', 'text-size', 12 * 1.8)
    expect(setPaint).toHaveBeenCalledTimes(10) // 2 paint calls per layer
  })

  it('skips non-symbol layers', () => {
    const { map, setLayout, setPaint } = makeMockMap([
      { id: 'settlement-fill', type: 'raster' },
      { id: 'place-label-bg', type: 'line' },
    ])
    boostSettlementLabels(map)
    expect(setLayout).not.toHaveBeenCalled()
    expect(setPaint).not.toHaveBeenCalled()
  })

  it('skips symbol layers whose id does not match a target fragment', () => {
    const { map, setLayout } = makeMockMap([
      { id: 'road-label', type: 'symbol' },
      { id: 'poi-label', type: 'symbol' },
      { id: 'country-label', type: 'symbol' },
    ])
    boostSettlementLabels(map)
    expect(setLayout).not.toHaveBeenCalled()
  })

  it('wraps expression text-size in a multiply expression (preserves zoom ramp)', () => {
    const zoomExpr = ['interpolate', ['linear'], ['zoom'], 6, 10, 10, 14]
    const { map, setLayout } = makeMockMap(
      [{ id: 'settlement-label', type: 'symbol' }],
      { 'settlement-label.text-size': zoomExpr }
    )
    boostSettlementLabels(map)
    expect(setLayout).toHaveBeenCalledWith('settlement-label', 'text-size', ['*', 1.8, zoomExpr])
  })

  it('skips undefined text-size instead of creating a malformed [*,1.8,undefined] expression', () => {
    const { map, setLayout, setPaint } = makeMockMap(
      [{ id: 'settlement-label', type: 'symbol' }],
      {} // text-size undefined
    )
    boostSettlementLabels(map)
    expect(setLayout).not.toHaveBeenCalled()
    // Halo still applied — the two concerns are independent now.
    expect(setPaint).toHaveBeenCalledTimes(2)
    expect(setPaint).toHaveBeenCalledWith('settlement-label', 'text-halo-width', 2)
    expect(setPaint).toHaveBeenCalledWith('settlement-label', 'text-halo-color', '#ffffff')
  })

  it('applies halo even when text-size setLayoutProperty throws (partial-mutation fix)', () => {
    const { map, setLayout, setPaint } = makeMockMap(
      [{ id: 'settlement-label', type: 'symbol' }],
      { 'settlement-label.text-size': 12 },
      { throwSetLayout: () => true }
    )
    boostSettlementLabels(map)
    // Size throw must NOT prevent halo application (previously it did).
    expect(setLayout).toHaveBeenCalled()
    expect(setPaint).toHaveBeenCalledTimes(2)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('logs (not throws) when setPaintProperty halo call throws', () => {
    const { map, setPaint } = makeMockMap(
      [{ id: 'settlement-label', type: 'symbol' }],
      { 'settlement-label.text-size': 12 },
      { throwSetPaint: () => true }
    )
    expect(() => boostSettlementLabels(map)).not.toThrow()
    expect(setPaint).toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('is a no-op when map.getStyle returns no layers (raster-only styles)', () => {
    const { map, setLayout } = makeMockMap([])
    boostSettlementLabels(map)
    expect(setLayout).not.toHaveBeenCalled()
  })

  it('handles map.getStyle() returning null without throwing', () => {
    const map = {
      getStyle: () => null,
      getLayoutProperty: vi.fn(),
      setLayoutProperty: vi.fn(),
      setPaintProperty: vi.fn(),
    } as any
    expect(() => boostSettlementLabels(map)).not.toThrow()
  })
})
