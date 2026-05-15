// Regression suite for the clipboard-payload parsers. These are the only
// pieces of `read-clipboard-photos` that decode untrusted binary data
// directly from the OS clipboard — anything any other process on the
// machine can write lands here. A regression in either function lets a
// hostile clipboard payload either silently drop legitimate paths
// (DoS-of-paste) or escape the UNC-path security gate (NTLM hash leak).
//
// The helpers live in `lib/clipboardParse.js` (pure CommonJS) so they can
// be exercised without spinning up Electron — vitest is enough.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseDropfiles, fileUriToPath } = require('../lib/clipboardParse');

// ---------------------------------------------------------------------------
// Test-only DROPFILES builder. Mirrors the Windows struct layout exactly:
//   pFiles  (DWORD, LE)  — offset where the path data starts (default 20)
//   pt      (POINT)      — drop point, 8 zero bytes for our purposes
//   fNC     (BOOL)       — drop in non-client area, 0
//   fWide   (BOOL)       — 1 for UTF-16LE paths, 0 for latin1
// Followed by the concatenated NUL-terminated path strings and a final
// extra NUL/00 00 sentinel (unless an `omitFinalTerminator` test wants to
// drop it to exercise the "no-trailing-sentinel" branch).
function buildDropfiles({
  paths,
  wide = true,
  offset = 20,
  omitFinalTerminator = false,
  extraPaddingBeforeBody = 0,
}) {
  const header = Buffer.alloc(20);
  header.writeUInt32LE(offset, 0); // pFiles
  // bytes 4..15 are POINT.x, POINT.y, fNC — all zero
  header.writeUInt32LE(wide ? 1 : 0, 16); // fWide

  const enc = wide ? 'utf16le' : 'latin1';
  const sep = wide ? Buffer.from([0, 0]) : Buffer.from([0]);

  const bodyChunks = [];
  for (const p of paths) {
    bodyChunks.push(Buffer.from(p, enc));
    bodyChunks.push(sep);
  }
  if (!omitFinalTerminator) {
    bodyChunks.push(sep);
  }
  const body = Buffer.concat(bodyChunks);

  const padding = Buffer.alloc(extraPaddingBeforeBody);
  return Buffer.concat([header, padding, body]);
}

// ---------------------------------------------------------------------------

describe('parseDropfiles — defensive bounds', () => {
  it('returns [] for null / undefined / empty input', () => {
    // Don't crash on garbage from a clipboard race or a `clipboard.readBuffer`
    // that returned an empty Buffer.
    expect(parseDropfiles(null)).toEqual([]);
    expect(parseDropfiles(undefined)).toEqual([]);
    expect(parseDropfiles(Buffer.alloc(0))).toEqual([]);
  });

  it('returns [] when the buffer is shorter than the 20-byte DROPFILES header', () => {
    // Reading UInt32LE at offset 16 on a 19-byte buffer would throw — the
    // length guard catches that before the reads happen.
    expect(parseDropfiles(Buffer.alloc(19))).toEqual([]);
  });

  it('returns [] when `pFiles` points before the header or past EOF', () => {
    // offset = 19 — before the header ends, malicious truncation.
    const tooSmall = Buffer.alloc(40);
    tooSmall.writeUInt32LE(19, 0);
    tooSmall.writeUInt32LE(1, 16);
    expect(parseDropfiles(tooSmall)).toEqual([]);

    // offset = 0xFFFFFFFF — past EOF, attacker overflow attempt.
    const tooBig = Buffer.alloc(40);
    tooBig.writeUInt32LE(0xFFFFFFFF, 0);
    tooBig.writeUInt32LE(1, 16);
    expect(parseDropfiles(tooBig)).toEqual([]);

    // offset = buf.length — points exactly at EOF, no data to read.
    const atEnd = Buffer.alloc(20);
    atEnd.writeUInt32LE(20, 0);
    atEnd.writeUInt32LE(1, 16);
    expect(parseDropfiles(atEnd)).toEqual([]);
  });

  it('rejects odd-offset wide-mode buffers (2-byte alignment required)', () => {
    // UTF-16LE code units are 2 bytes; starting at an odd offset would
    // shift every code unit by a byte and produce garbage decodes.
    const buf = buildDropfiles({
      paths: ['C:\\foo.jpg'],
      wide: true,
      offset: 21,
      extraPaddingBeforeBody: 1, // shift body by 1 byte so offset 21 lands on data
    });
    expect(parseDropfiles(buf)).toEqual([]);
  });
});

describe('parseDropfiles — wide (UTF-16LE)', () => {
  it('decodes a single well-formed path', () => {
    const buf = buildDropfiles({ paths: ['C:\\Users\\photo.jpg'], wide: true });
    expect(parseDropfiles(buf)).toEqual(['C:\\Users\\photo.jpg']);
  });

  it('decodes multiple paths in order', () => {
    const buf = buildDropfiles({
      paths: ['C:\\a.jpg', 'C:\\b.png', 'D:\\nested\\c.jpeg'],
      wide: true,
    });
    expect(parseDropfiles(buf)).toEqual([
      'C:\\a.jpg',
      'C:\\b.png',
      'D:\\nested\\c.jpeg',
    ]);
  });

  it('decodes non-ASCII paths (Czech diacritics)', () => {
    // Total Commander on a Czech Windows produces UTF-16LE with full
    // Unicode — must round-trip cleanly.
    const buf = buildDropfiles({
      paths: ['C:\\Užívatel\\fotografie\\přípravná.jpg'],
      wide: true,
    });
    expect(parseDropfiles(buf)).toEqual([
      'C:\\Užívatel\\fotografie\\přípravná.jpg',
    ]);
  });

  it('returns [] when the body is just the empty-sentinel double-NUL', () => {
    // Body = 00 00. The loop sees i === start at i=0 and breaks
    // immediately — no paths to decode.
    const buf = buildDropfiles({ paths: [], wide: true });
    expect(parseDropfiles(buf)).toEqual([]);
  });

  it('decodes the trailing path when the producer omits the final double-NUL sentinel', () => {
    // Some shell extensions ship CF_HDROP without the trailing terminator.
    // Pre-fix: the loop fell off the end with the last path still in
    // `start..tail.length` and silently dropped it. The 5-file paste
    // arrived as 4. Regression-pin the trailing-decode branch.
    const buf = buildDropfiles({
      paths: ['C:\\a.jpg', 'C:\\trailing.jpg'],
      wide: true,
      omitFinalTerminator: true,
    });
    expect(parseDropfiles(buf)).toEqual(['C:\\a.jpg', 'C:\\trailing.jpg']);
  });

  it('strips a trailing odd byte before UTF-16 decode of the unterminated remainder', () => {
    // A 5-byte tail (e.g. `0061 0062 80`) in wide mode would otherwise
    // produce garbage if decoded as 6 bytes; the parser must shave the
    // odd byte off before `toString('utf16le')`.
    const header = Buffer.alloc(20);
    header.writeUInt32LE(20, 0);
    header.writeUInt32LE(1, 16);
    // 'a' 'b' then a stray byte, no terminator. utf16le decode of [0x61,0x00,0x62,0x00] = 'ab'.
    const oddTail = Buffer.concat([
      Buffer.from('ab', 'utf16le'),
      Buffer.from([0x80]),
    ]);
    const buf = Buffer.concat([header, oddTail]);
    expect(parseDropfiles(buf)).toEqual(['ab']);
  });
});

describe('parseDropfiles — narrow (latin1)', () => {
  it('decodes a single well-formed path', () => {
    const buf = buildDropfiles({ paths: ['C:\\Users\\photo.jpg'], wide: false });
    expect(parseDropfiles(buf)).toEqual(['C:\\Users\\photo.jpg']);
  });

  it('decodes multiple paths in order', () => {
    const buf = buildDropfiles({
      paths: ['C:\\a.jpg', 'C:\\b.png'],
      wide: false,
    });
    expect(parseDropfiles(buf)).toEqual(['C:\\a.jpg', 'C:\\b.png']);
  });

  it('decodes the trailing path when the producer omits the final NUL sentinel', () => {
    const buf = buildDropfiles({
      paths: ['C:\\a.jpg', 'C:\\trailing.jpg'],
      wide: false,
      omitFinalTerminator: true,
    });
    expect(parseDropfiles(buf)).toEqual(['C:\\a.jpg', 'C:\\trailing.jpg']);
  });
});

describe('fileUriToPath — POSIX', () => {
  it('decodes a basic file:// URI', () => {
    expect(fileUriToPath('file:///Users/lukas/photo.jpg', 'darwin')).toBe(
      '/Users/lukas/photo.jpg',
    );
  });

  it('decodes percent-encoded spaces and Unicode', () => {
    expect(fileUriToPath('file:///Users/lukas/My%20Photos/p.jpg', 'darwin')).toBe(
      '/Users/lukas/My Photos/p.jpg',
    );
    expect(
      fileUriToPath('file:///home/lukas/fotografie/p%C5%99%C3%ADprava.jpg', 'linux'),
    ).toBe('/home/lukas/fotografie/příprava.jpg');
  });

  it('accepts an explicit `localhost` authority (RFC 8089 §2)', () => {
    expect(fileUriToPath('file://localhost/etc/passwd', 'linux')).toBe(
      '/etc/passwd',
    );
  });
});

describe('fileUriToPath — Windows', () => {
  it('strips the leading slash and converts forward to back slashes', () => {
    expect(fileUriToPath('file:///C:/Users/lukas/photo.jpg', 'win32')).toBe(
      'C:\\Users\\lukas\\photo.jpg',
    );
  });

  it('decodes percent-encoded characters before slash conversion', () => {
    expect(
      fileUriToPath('file:///C:/Users/lukas/My%20Photos/p.jpg', 'win32'),
    ).toBe('C:\\Users\\lukas\\My Photos\\p.jpg');
  });
});

describe('fileUriToPath — authority gate (security)', () => {
  it('REJECTS non-empty, non-localhost authority (NTLM hash leak vector)', () => {
    // The whole point of the gate. `file://attacker.tld/share/loot.jpg`
    // is the URI spelling of `\\attacker.tld\share\loot.jpg`; if the
    // downstream lstat ever ran on it, Windows would helpfully establish
    // an SMB session to attacker.tld and leak the user's NTLMv2 hash in
    // the handshake. Returning null at the parser keeps the path out of
    // the pipeline entirely; `isSafeStartDir` would also catch it later
    // as defence-in-depth.
    expect(fileUriToPath('file://attacker.tld/share/loot.jpg', 'win32')).toBeNull();
    expect(fileUriToPath('file://192.168.1.1/share/x.jpg', 'win32')).toBeNull();
    expect(fileUriToPath('file://example.com/x.jpg', 'darwin')).toBeNull();
  });

  it('treats `localhost` case-insensitively per RFC 3986 §3.2.2', () => {
    expect(fileUriToPath('file://LOCALHOST/etc/passwd', 'linux')).toBe('/etc/passwd');
    expect(fileUriToPath('file://Localhost/x', 'linux')).toBe('/x');
  });
});

describe('fileUriToPath — defensive', () => {
  it('returns null for non-string input', () => {
    expect(fileUriToPath(null)).toBeNull();
    expect(fileUriToPath(undefined)).toBeNull();
    expect(fileUriToPath(42)).toBeNull();
    expect(fileUriToPath({})).toBeNull();
  });

  it('returns null for non-file scheme', () => {
    expect(fileUriToPath('http://example.com/x.jpg')).toBeNull();
    expect(fileUriToPath('https://example.com/x.jpg')).toBeNull();
    expect(fileUriToPath('javascript:alert(1)')).toBeNull();
  });

  it('returns null for file:// without a path part', () => {
    // `file://localhost` with no trailing slash has no `/path` group — the
    // regex requires `(\/.*)`. Returning null keeps the pipeline empty.
    expect(fileUriToPath('file://localhost')).toBeNull();
    expect(fileUriToPath('file://')).toBeNull();
  });

  it('returns null on malformed percent-encoding (decodeURI throws)', () => {
    // `%ZZ` is not a valid percent-encoded byte; decodeURI throws URIError.
    // The catch must convert that to a quiet null instead of bringing
    // down the IPC handler.
    expect(fileUriToPath('file:///bad%ZZpath')).toBeNull();
  });
});
