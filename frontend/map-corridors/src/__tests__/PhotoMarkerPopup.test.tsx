import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PhotoMarkerPopup, type PhotoMarkerPopupProps } from '../components/PhotoMarkerPopup'
import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage'

// A3 (2026-05-30) split the single "Include" button into two category
// buttons — Track (blue/primary) and Turning-point (purple/secondary) —
// each wired to its own handler. The wiring is pure UI (which button calls
// which callback, which one is highlighted for the marker's current flag)
// and had no test, so a swapped handler or a wrong-button highlight would
// ship green. These pin the button → handler mapping and the active-state
// highlight in both directions.

// Stub useI18n so we don't spin up I18nContext. Echo the key back, so a
// button's accessible name is its translation key (e.g. 'photo.popup.pickTrack').
vi.mock('../contexts/I18nContext', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

// Stub the thumbnail hook — rendering the real one pulls in storage I/O and
// blob URLs. We only care about the action buttons here.
vi.mock('../components/usePhotoThumbUrl', () => ({
  usePhotoThumbUrl: () => ({ url: null, state: 'missing' as const }),
}))

afterEach(cleanup)

function renderPopup(overrides: Partial<PhotoMarkerPopupProps> = {}) {
  const onIncludeTrack = vi.fn()
  const onIncludeTurning = vi.fn()
  const onSkip = vi.fn()
  const onReject = vi.fn()
  const props: PhotoMarkerPopupProps = {
    photoId: 'pm-1',
    filename: 'DSC_0001.JPG',
    storage: {} as StorageInterface,
    photosDir: {} as DirectoryHandle,
    onIncludeTrack,
    onIncludeTurning,
    onSkip,
    onReject,
    ...overrides,
  }
  render(<PhotoMarkerPopup {...props} />)
  const trackBtn = screen.getByRole('button', { name: 'photo.popup.pickTrack' })
  const turningBtn = screen.getByRole('button', { name: 'photo.popup.pickTurning' })
  return { props, onIncludeTrack, onIncludeTurning, onSkip, onReject, trackBtn, turningBtn }
}

describe('PhotoMarkerPopup — track/turning button wiring', () => {
  it('renders both category buttons plus skip and reject', () => {
    renderPopup()
    expect(screen.getByRole('button', { name: 'photo.popup.pickTrack' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'photo.popup.pickTurning' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'photo.popup.skip' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'photo.popup.reject' })).toBeInTheDocument()
  })

  it('Track button fires onIncludeTrack ONLY (handlers not crossed)', () => {
    const { trackBtn, onIncludeTrack, onIncludeTurning, onSkip, onReject } = renderPopup()
    fireEvent.click(trackBtn)
    expect(onIncludeTrack).toHaveBeenCalledTimes(1)
    expect(onIncludeTurning).not.toHaveBeenCalled()
    expect(onSkip).not.toHaveBeenCalled()
    expect(onReject).not.toHaveBeenCalled()
  })

  it('Turning button fires onIncludeTurning ONLY (handlers not crossed)', () => {
    const { turningBtn, onIncludeTrack, onIncludeTurning } = renderPopup()
    fireEvent.click(turningBtn)
    expect(onIncludeTurning).toHaveBeenCalledTimes(1)
    expect(onIncludeTrack).not.toHaveBeenCalled()
  })

  it('skip / reject buttons fire their own handlers', () => {
    const { onSkip, onReject, onIncludeTrack, onIncludeTurning } = renderPopup()
    fireEvent.click(screen.getByRole('button', { name: 'photo.popup.skip' }))
    fireEvent.click(screen.getByRole('button', { name: 'photo.popup.reject' }))
    expect(onSkip).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onIncludeTrack).not.toHaveBeenCalled()
    expect(onIncludeTurning).not.toHaveBeenCalled()
  })

  it('flag="pick-track" highlights Track (contained) and leaves Turning outlined', () => {
    const { trackBtn, turningBtn } = renderPopup({ flag: 'pick-track' })
    expect(trackBtn).toHaveClass('MuiButton-contained')
    expect(turningBtn).toHaveClass('MuiButton-outlined')
  })

  it('flag="pick-turning" highlights Turning (contained) and leaves Track outlined', () => {
    const { trackBtn, turningBtn } = renderPopup({ flag: 'pick-turning' })
    expect(turningBtn).toHaveClass('MuiButton-contained')
    expect(trackBtn).toHaveClass('MuiButton-outlined')
  })

  it('no flag (un-categorized) leaves BOTH category buttons outlined', () => {
    const { trackBtn, turningBtn } = renderPopup()
    expect(trackBtn).toHaveClass('MuiButton-outlined')
    expect(turningBtn).toHaveClass('MuiButton-outlined')
    expect(trackBtn).not.toHaveClass('MuiButton-contained')
    expect(turningBtn).not.toHaveClass('MuiButton-contained')
  })

  it('flag="reject" does not highlight either category button', () => {
    const { trackBtn, turningBtn } = renderPopup({ flag: 'reject' })
    expect(trackBtn).toHaveClass('MuiButton-outlined')
    expect(turningBtn).toHaveClass('MuiButton-outlined')
  })
})
