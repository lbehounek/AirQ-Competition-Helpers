// Pure clipboard-payload parsers shared by the Electron main process and the
// test suite. Extracted from `main.js` so the binary-format edge cases —
// off-by-one terminators, malformed CF_HDROP headers, file:// authority
// handling — can be unit-tested directly without spinning up Electron.
//
// The handler that calls these (`readClipboardFilePaths` in main.js) still
// lives in main because it depends on Electron's `clipboard` module; only
// the format-decoder pieces are pure enough to move here.

// Parse a Windows CF_HDROP buffer (DROPFILES struct) into an array of file
// paths. Layout: 20-byte header (DWORD pFiles, POINT pt, BOOL fNC, BOOL fWide),
// then a flat array of NUL-terminated path strings terminated by an extra
// NUL/00 00 sentinel. Total Commander, Explorer and 7-Zip all populate
// CF_HDROP on Ctrl+C.
//
// Defensive against malformed buffers because the source is the OS
// clipboard — anything any other process can write goes in here.
function parseDropfiles(buf) {
  if (!buf || buf.length < 20) return [];
  const offset = buf.readUInt32LE(0);
  const wide = buf.readUInt32LE(16) !== 0;
  if (offset < 20 || offset >= buf.length) return [];
  // Wide-mode (UTF-16LE) must start on a 2-byte boundary. An odd offset
  // would shift every code unit by a byte and produce garbage decodes.
  if (wide && (offset & 1)) return [];
  const tail = buf.subarray(offset);
  const paths = [];
  if (wide) {
    let start = 0;
    let terminated = false;
    for (let i = 0; i + 1 < tail.length; i += 2) {
      if (tail[i] === 0 && tail[i + 1] === 0) {
        if (i === start) { terminated = true; break; }
        const str = tail.subarray(start, i).toString('utf16le');
        if (str) paths.push(str);
        start = i + 2;
        terminated = true;
      } else {
        terminated = false;
      }
    }
    // Some shell extensions ship CF_HDROP without the trailing double-NUL
    // sentinel. If the loop fell off the end without a final terminator
    // and there is a non-empty in-progress slice, decode it anyway —
    // dropping it silently was a reported partial-paste pattern.
    if (!terminated && start + 1 < tail.length) {
      const remainder = tail.subarray(start, tail.length - (tail.length & 1));
      const str = remainder.toString('utf16le');
      if (str) paths.push(str);
    }
  } else {
    let start = 0;
    let terminated = false;
    for (let i = 0; i < tail.length; i++) {
      if (tail[i] === 0) {
        if (i === start) { terminated = true; break; }
        const str = tail.subarray(start, i).toString('latin1');
        if (str) paths.push(str);
        start = i + 1;
        terminated = true;
      } else {
        terminated = false;
      }
    }
    if (!terminated && start < tail.length) {
      const str = tail.subarray(start).toString('latin1');
      if (str) paths.push(str);
    }
  }
  return paths;
}

// Decode a file:// URI (RFC 8089) into a local path. Used for macOS
// `public.file-url` and the cross-platform `text/uri-list` clipboard
// formats.
//
// Per RFC 8089 the authority MUST be empty or `localhost`. A non-empty
// authority is the URI form of `\\server\share` and would let a clipboard
// payload point at an attacker-controlled SMB host, triggering an NTLMv2
// handshake on the follow-up lstat (Windows hash leak). The downstream
// `isSafeStartDir` gate also rejects UNC paths — this is defence-in-depth
// at the parser so a remote share never gets normalised into the pipeline.
//
// `platform` is parameterised (defaults to `process.platform`) so the
// Windows-specific slash conversion can be exercised by tests on any host.
function fileUriToPath(uri, platform = process.platform) {
  try {
    if (typeof uri !== 'string') return null;
    const m = /^file:\/\/([^/]*)(\/.*)$/.exec(uri);
    if (!m) return null;
    const authority = m[1];
    if (authority && authority.toLowerCase() !== 'localhost') return null;
    let p = decodeURI(m[2]);
    if (platform === 'win32') {
      if (p.startsWith('/')) p = p.slice(1);
      p = p.replace(/\//g, '\\');
    }
    return p;
  } catch {
    return null;
  }
}

module.exports = {
  parseDropfiles,
  fileUriToPath,
};
