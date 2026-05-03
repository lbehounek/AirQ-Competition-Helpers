// Path-validation regression suite. The validators are the load-bearing
// security boundary for every Electron IPC handler that touches the
// filesystem (`competition-create`, `pick-directory`, `read-photo-file`).
// A regression in any of them lets a compromised renderer escape the
// per-user storage root, so these tests pin the behaviour.
//
// The helpers live in `lib/pathValidation.js` (pure CommonJS) — extracted
// from `main.js` specifically so they could be tested without spinning
// up Electron. The test file uses ESM-style `import` for vitest (required
// by vitest 4) but the module under test stays CommonJS — Node ESM-CJS
// interop handles the bridge.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  MAX_USER_PATH_LEN,
  sanitizeFileName,
  isSafeStartDir,
  validateUserDir,
  validateStoragePath,
} = require('../lib/pathValidation');

describe('sanitizeFileName', () => {
  it('passes through clean ASCII identifiers unchanged', () => {
    expect(sanitizeFileName('comp-1234567890-abc123')).toBe('comp-1234567890-abc123');
    expect(sanitizeFileName('photo.jpg')).toBe('photo.jpg');
    expect(sanitizeFileName('My_File-2026.kml')).toBe('My_File-2026.kml');
  });

  it('returns "file" for non-string inputs', () => {
    // Defensive: a renderer that bypasses preload (somehow) shouldn't
    // crash main.js. Returning a safe placeholder lets the caller proceed
    // to validateStoragePath which will reject the resulting path.
    expect(sanitizeFileName(null)).toBe('file');
    expect(sanitizeFileName(undefined)).toBe('file');
    expect(sanitizeFileName(42)).toBe('file');
    expect(sanitizeFileName({})).toBe('file');
  });

  it('replaces path separators with dashes (path traversal containment)', () => {
    // Both POSIX and Windows separators must die. The output is then fed
    // to `path.join`, where a remaining `..` segment would still be a
    // traversal attempt — so the strict allowlist below ALSO catches `..`
    // in the form of `..-..--evil` rather than letting it through.
    expect(sanitizeFileName('a/b')).toBe('a-b');
    expect(sanitizeFileName('a\\b')).toBe('a-b');
    expect(sanitizeFileName('../../etc/passwd')).toBe('..-..-etc-passwd');
    expect(sanitizeFileName('..\\..\\Windows\\System32')).toBe('..-..-Windows-System32');
  });

  it('strips control characters (NUL through 0x1F and 0x7F)', () => {
    // Null bytes are particularly dangerous — they truncate paths in
    // some lower-level APIs. Strip every control char to be safe.
    expect(sanitizeFileName('foo\x00bar')).toBe('foobar');
    expect(sanitizeFileName('foo\x1Fbar')).toBe('foobar');
    expect(sanitizeFileName('foo\x7Fbar')).toBe('foobar');
    expect(sanitizeFileName('foo\nbar\tbaz')).toBe('foobarbaz');
  });

  it('replaces all non-allowlisted chars with dashes', () => {
    // Allowlist is `[A-Za-z0-9._-]`. Czech diacritics, spaces, emojis,
    // shell metacharacters all become dashes.
    // 'ě' and 'ž' are non-allowlisted (each → '-'), the space is also '-',
    // so 'soutěž 2026' becomes 'sout---2026' (three dashes).
    expect(sanitizeFileName('soutěž 2026')).toBe('sout---2026');
    expect(sanitizeFileName('a&b|c;d')).toBe('a-b-c-d');
    // 'foo;rm -rf /' → step 1 turns '/' into '-' (trailing dash), step 4
    // turns ';' and the two spaces into dashes, producing two trailing dashes
    // (one from the space-before-`/`-was-already-`-`, one from the original `/`).
    expect(sanitizeFileName('foo;rm -rf /')).toBe('foo-rm--rf--');
  });

  it('truncates to 128 characters', () => {
    const long = 'a'.repeat(500);
    const out = sanitizeFileName(long);
    expect(out.length).toBe(128);
    expect(out).toBe('a'.repeat(128));
  });

  it('returns "file" when every character gets stripped', () => {
    // All-whitespace, all-control-char inputs yield empty after sanitisation.
    expect(sanitizeFileName('   ')).toBe('file');
    expect(sanitizeFileName('\x00\x01\x02')).toBe('file');
    expect(sanitizeFileName('')).toBe('file');
  });

  it('preserves the documented allowlisted characters intact', () => {
    expect(sanitizeFileName('a-b_c.d')).toBe('a-b_c.d');
    expect(sanitizeFileName('ABC-xyz_123.ext')).toBe('ABC-xyz_123.ext');
  });
});

describe('isSafeStartDir', () => {
  it('rejects non-string and empty inputs', () => {
    expect(isSafeStartDir(null)).toBe(false);
    expect(isSafeStartDir(undefined)).toBe(false);
    expect(isSafeStartDir('')).toBe(false);
    expect(isSafeStartDir(42)).toBe(false);
  });

  it('rejects UNC paths (\\\\server\\share)', () => {
    // The NTLMv2 leak vector — a UNC default path triggers an SMB
    // handshake to the attacker-controlled host on Windows.
    expect(isSafeStartDir('\\\\fileserver\\public')).toBe(false);
    expect(isSafeStartDir('\\\\evil.example.com\\share')).toBe(false);
  });

  it('rejects POSIX-style UNC representations (//server/share)', () => {
    // path.resolve normalises some of these on certain runtimes; the
    // validator catches both styles upfront.
    expect(isSafeStartDir('//fileserver/public')).toBe(false);
  });

  it('rejects Windows device namespaces (\\\\?\\..., \\\\.\\..., )', () => {
    // The `\\?\` namespace bypasses MAX_PATH and skips Win32 path
    // normalisation; `\\.\` reaches device drivers directly. Either is a
    // long-tail bypass surface — neither should ever land in a save
    // dialog default.
    expect(isSafeStartDir('\\\\?\\C:\\Windows')).toBe(false);
    expect(isSafeStartDir('\\\\.\\PhysicalDrive0')).toBe(false);
  });

  it('accepts ordinary local paths', () => {
    expect(isSafeStartDir('C:\\Users\\alice\\Documents')).toBe(true);
    expect(isSafeStartDir('/home/alice/Documents')).toBe(true);
    expect(isSafeStartDir('D:\\rally-2026')).toBe(true);
  });
});

describe('validateUserDir', () => {
  let tmpDir;
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airq-pathval-'));
  });
  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('accepts an existing local directory', () => {
    expect(validateUserDir(tmpDir)).toBe(path.resolve(tmpDir));
  });

  it('rejects non-string inputs', () => {
    expect(validateUserDir(null)).toBeNull();
    expect(validateUserDir(undefined)).toBeNull();
    expect(validateUserDir(42)).toBeNull();
  });

  it('rejects empty / whitespace-only strings', () => {
    expect(validateUserDir('')).toBeNull();
    expect(validateUserDir('   ')).toBeNull();
  });

  it('rejects strings longer than MAX_USER_PATH_LEN', () => {
    expect(MAX_USER_PATH_LEN).toBe(4096);
    const tooLong = 'a' + '/b'.repeat(MAX_USER_PATH_LEN);
    expect(validateUserDir(tooLong)).toBeNull();
  });

  it('rejects non-existent paths', () => {
    const ghost = path.join(tmpDir, 'definitely-does-not-exist-' + Date.now());
    expect(validateUserDir(ghost)).toBeNull();
  });

  it('rejects paths that exist but are not directories', () => {
    const file = path.join(tmpDir, 'a-file.txt');
    fs.writeFileSync(file, 'hello', 'utf8');
    expect(validateUserDir(file)).toBeNull();
  });

  it('rejects UNC paths', () => {
    // Even if a UNC path happens to resolve, validateUserDir blocks it
    // via isSafeStartDir BEFORE touching the filesystem.
    expect(validateUserDir('\\\\fileserver\\share')).toBeNull();
    expect(validateUserDir('//fileserver/share')).toBeNull();
  });

  it('rejects Windows device namespaces', () => {
    expect(validateUserDir('\\\\?\\C:\\Windows')).toBeNull();
    expect(validateUserDir('\\\\.\\PhysicalDrive0')).toBeNull();
  });
});

describe('validateStoragePath', () => {
  let storageRoot;
  beforeAll(() => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'airq-storage-root-'));
  });
  afterAll(() => {
    try { fs.rmSync(storageRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('accepts a path strictly inside the storage root', () => {
    const inside = path.join(storageRoot, 'competitions', 'comp-123');
    expect(validateStoragePath(inside, storageRoot)).toBe(path.resolve(inside));
  });

  it('accepts the storage root itself', () => {
    // The convention: `path.startsWith(root + sep)` would NOT match the
    // root directly, so the validator has an explicit `=== rootPath`
    // branch. Pin it.
    expect(validateStoragePath(storageRoot, storageRoot)).toBe(path.resolve(storageRoot));
  });

  it('rejects a `..` traversal attempt that escapes the root', () => {
    const escape = path.join(storageRoot, '..', 'evil');
    expect(() => validateStoragePath(escape, storageRoot)).toThrow(/Access denied/);
  });

  it('rejects a path lexically outside the root (no shared prefix)', () => {
    expect(() => validateStoragePath('/tmp/elsewhere', storageRoot)).toThrow(/Access denied/);
  });

  it('rejects a prefix-confusion neighbour (root + extra letters)', () => {
    // Round-5 test for the "/foo/bar matches /foo/barbaz" class: the
    // validator uses `startsWith(root + path.sep)` precisely to block
    // this. A regression that drops the trailing separator would
    // accept `<root>BAD` as if it were inside the root.
    const neighbour = path.resolve(storageRoot) + 'BAD';
    expect(() => validateStoragePath(neighbour, storageRoot)).toThrow(/Access denied/);
  });

  it('normalises before comparing (./, redundant separators)', () => {
    // `path.resolve` collapses `./` and double separators. A path that's
    // truly inside the root after normalisation is accepted.
    const messy = path.join(storageRoot, '.', 'sub', '.', 'leaf');
    const expected = path.resolve(path.join(storageRoot, 'sub', 'leaf'));
    expect(validateStoragePath(messy, storageRoot)).toBe(expected);
  });

  it('an embedded `..` that resolves back inside the root is accepted post-normalisation', () => {
    // Some validators are fooled by `<root>/sub/../leaf` (which resolves
    // BACK inside the root). Lexical `path.resolve` correctly normalises
    // this to `<root>/leaf`, which IS inside the root — so this test
    // pins the documented behaviour rather than asserting rejection.
    // What matters is that the resolved path lives under the root, NOT
    // the literal string the caller supplied.
    const stillInside = path.join(storageRoot, 'sub', '..', 'leaf');
    expect(validateStoragePath(stillInside, storageRoot)).toBe(
      path.resolve(path.join(storageRoot, 'leaf'))
    );
  });
});
