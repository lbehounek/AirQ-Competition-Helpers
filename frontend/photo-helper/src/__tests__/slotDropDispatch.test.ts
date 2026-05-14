import { describe, it, expect } from 'vitest';
import { dispatchSlotDrop } from '../utils/slotDropDispatch';
import type { DragPayload } from '../utils/dragPayload';

// PR #62 review I4: the pre-fix `handleDrop` silently dropped native OS file
// drops on occupied slots — neither the structured payload nor the text/plain
// reorder matched, `e.preventDefault()` had already suppressed the dropzone
// wrapper, and the files vanished from the cursor with no toast, no error,
// no smart-drop routing. The extracted `dispatchSlotDrop` helper now decides
// the action up-front so the component shell is pure dispatch and the rules
// can be tested without rendering MUI/contexts/react-dropzone.

const acceptAllImages = (f: File) => f.type.startsWith('image/');

function makeFile(name: string, type = 'image/jpeg'): File {
  return new File([new Uint8Array([0xFF])], name, { type });
}

describe('dispatchSlotDrop — structured payload dispatch', () => {
  it('routes a tray payload to promote with the drop index', () => {
    const payload: DragPayload = { kind: 'tray', photoId: 'cand-1' };
    const action = dispatchSlotDrop({
      payload,
      textPlain: '',
      files: [],
      dropIndex: 3,
      setKey: 'set1',
      isValidImageFile: acceptAllImages,
    });
    expect(action).toEqual({ kind: 'promote', photoId: 'cand-1', dropIndex: 3 });
  });

  it('routes a cross-set slot payload to rejection', () => {
    const payload: DragPayload = { kind: 'slot', setKey: 'set2', index: 4, photoId: 'p' };
    const action = dispatchSlotDrop({
      payload,
      textPlain: '4',
      files: [],
      dropIndex: 1,
      setKey: 'set1',
      isValidImageFile: acceptAllImages,
    });
    expect(action).toEqual({ kind: 'cross-set-rejected' });
  });

  it('lets a same-set slot payload fall through to text/plain reorder', () => {
    // Same-set drags emit BOTH the structured payload AND text/plain. The
    // structured payload's setKey matches, so dispatch falls through to the
    // legacy reorder path keyed on the integer index.
    const payload: DragPayload = { kind: 'slot', setKey: 'set1', index: 2, photoId: 'p' };
    const action = dispatchSlotDrop({
      payload,
      textPlain: '2',
      files: [],
      dropIndex: 5,
      setKey: 'set1',
      isValidImageFile: acceptAllImages,
    });
    expect(action).toEqual({ kind: 'reorder', fromIndex: 2, toIndex: 5 });
  });
});

describe('dispatchSlotDrop — text/plain reorder', () => {
  it('routes integer text/plain to reorder when fromIndex != dropIndex', () => {
    const action = dispatchSlotDrop({
      payload: null,
      textPlain: '2',
      files: [],
      dropIndex: 5,
      setKey: 'set1',
      isValidImageFile: acceptAllImages,
    });
    expect(action).toEqual({ kind: 'reorder', fromIndex: 2, toIndex: 5 });
  });

  it('returns none when fromIndex === dropIndex (no-op reorder)', () => {
    const action = dispatchSlotDrop({
      payload: null,
      textPlain: '3',
      files: [],
      dropIndex: 3,
      setKey: 'set1',
      isValidImageFile: acceptAllImages,
    });
    expect(action).toEqual({ kind: 'none' });
  });

  it('falls through reorder when text/plain is empty / NaN', () => {
    const action = dispatchSlotDrop({
      payload: null,
      textPlain: '',
      files: [],
      dropIndex: 5,
      setKey: 'set1',
      isValidImageFile: acceptAllImages,
    });
    expect(action).toEqual({ kind: 'none' });
  });
});

describe('dispatchSlotDrop — native file drop (PR #62 review I4)', () => {
  it('routes native files to onFilesDropped when no payload and no reorder int', () => {
    // The pre-I4 bug: occupied slot + native OS file drop → silently dropped.
    const files = [makeFile('a.jpg'), makeFile('b.jpg')];
    const action = dispatchSlotDrop({
      payload: null,
      textPlain: '',
      files,
      dropIndex: 5,
      setKey: 'set1',
      isValidImageFile: acceptAllImages,
    });
    expect(action).toEqual({ kind: 'files', files });
  });

  it('filters out non-image files via isValidImageFile', () => {
    const valid = makeFile('photo.jpg', 'image/jpeg');
    const invalid = makeFile('doc.pdf', 'application/pdf');
    const action = dispatchSlotDrop({
      payload: null,
      textPlain: '',
      files: [valid, invalid],
      dropIndex: 1,
      setKey: 'set1',
      isValidImageFile: acceptAllImages,
    });
    expect(action).toEqual({ kind: 'files', files: [valid] });
  });

  it('returns none when ALL native files are filtered out (no images)', () => {
    // Don't fire `onFilesDropped([])` — that would be a meaningless smart-drop.
    const action = dispatchSlotDrop({
      payload: null,
      textPlain: '',
      files: [makeFile('a.txt', 'text/plain')],
      dropIndex: 1,
      setKey: 'set1',
      isValidImageFile: acceptAllImages,
    });
    expect(action).toEqual({ kind: 'none' });
  });

  it('does NOT fire files action when text/plain reorder matched (priority)', () => {
    // A user dragging a slot photo in-grid may emit text/plain AND have
    // dataTransfer.files leftover from somewhere. Reorder wins.
    const files = [makeFile('a.jpg')];
    const action = dispatchSlotDrop({
      payload: null,
      textPlain: '2',
      files,
      dropIndex: 5,
      setKey: 'set1',
      isValidImageFile: acceptAllImages,
    });
    expect(action).toEqual({ kind: 'reorder', fromIndex: 2, toIndex: 5 });
  });

  it('does NOT fire files action when tray payload matched (priority)', () => {
    const files = [makeFile('a.jpg')];
    const payload: DragPayload = { kind: 'tray', photoId: 'cand-1' };
    const action = dispatchSlotDrop({
      payload,
      textPlain: '',
      files,
      dropIndex: 1,
      setKey: 'set1',
      isValidImageFile: acceptAllImages,
    });
    expect(action).toEqual({ kind: 'promote', photoId: 'cand-1', dropIndex: 1 });
  });
});

describe('dispatchSlotDrop — empty/no-op cases', () => {
  it('returns none when nothing is in the dataTransfer at all', () => {
    const action = dispatchSlotDrop({
      payload: null,
      textPlain: '',
      files: [],
      dropIndex: 5,
      setKey: 'set1',
      isValidImageFile: acceptAllImages,
    });
    expect(action).toEqual({ kind: 'none' });
  });
});
