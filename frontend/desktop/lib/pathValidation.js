// Pure path-validation helpers shared by the Electron main process and the
// test suite. Extracted from main.js so the lexical containment, UNC
// rejection, and filename sanitisation rules can be unit-tested directly
// without spinning up Electron — the validators are the load-bearing
// security boundary for every IPC handler that touches the filesystem
// (`competition-create`, `pick-directory`, `read-photo-file`, etc.), and a
// regression in any of them would let a compromised renderer escape the
// per-user storage root.

const fs = require('fs');
const path = require('path');

const MAX_USER_PATH_LEN = 4096;

// Strip path separators, control chars, and non-`[A-Za-z0-9._-]` content,
// then truncate to 128. Falls back to `'file'` if every char gets stripped
// (e.g. an all-whitespace input).
function sanitizeFileName(input) {
  if (typeof input !== 'string') return 'file';
  // Order matters: replace separators with `-` BEFORE the strict allowlist
  // pass below so a `..\..\evil` payload becomes `..-..--evil`, not `evil`.
  const stripped = input
    .replace(/[\\/]/g, '-')
    .replace(new RegExp('[\\u0000-\\u001F\\u007F]', 'g'), '')
    .trim();
  const normalized = stripped.replace(/[^A-Za-z0-9._-]/g, '-');
  const truncated = normalized.slice(0, 128);
  return truncated.length > 0 ? truncated : 'file';
}

// Reject UNC paths (`\\server\share`, `//server/share`) and Windows device
// namespaces (`\\?\`, `\\.\`). A renderer-supplied UNC path as the save
// dialog's `defaultPath` would pre-point the user at an attacker-controlled
// SMB share — one click later the KML lands remote and, on Windows, an
// NTLMv2 handshake to the attacker's host leaks the user's hashed creds.
function isSafeStartDir(abs) {
  if (typeof abs !== 'string' || !abs) return false;
  if (/^(\\\\|\/\/)/.test(abs)) return false;
  if (/^\\\\[?.]\\/.test(abs)) return false;
  return true;
}

// Single source of truth for "renderer gave us a directory string — should we
// trust it as `defaultPath` for a dialog or persist it as workingDir?". Wraps
// the four checks (type, length cap, UNC/device rejection, on-disk presence)
// that were copy-pasted across handlers and easy to forget on new ones.
function validateUserDir(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  if (input.length > MAX_USER_PATH_LEN) return null;
  let abs;
  try { abs = path.resolve(input); } catch { return null; }
  if (!isSafeStartDir(abs)) return null;
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return null;
  } catch { return null; }
  return abs;
}

// Validate that a path is within the allowed storage directory (prevent path
// traversal). Lexical containment via `path.resolve` + `startsWith(rootPath +
// path.sep)` — the trailing-separator check prevents prefix-confusion bugs
// like `/foo/bar` matching `/foo/barbaz`. Accepts a `rootPath` so tests can
// inject a tmpdir without depending on Electron's `app.getPath('userData')`.
function validateStoragePath(inputPath, rootPath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolved = path.resolve(inputPath);
  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    throw new Error('Access denied: path outside storage directory');
  }
  return resolved;
}

module.exports = {
  MAX_USER_PATH_LEN,
  sanitizeFileName,
  isSafeStartDir,
  validateUserDir,
  validateStoragePath,
};
