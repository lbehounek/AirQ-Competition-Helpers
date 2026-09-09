// Regression guard for the `afterSample` IPC gate in `main.js`.
//
// WHY THIS IS A SOURCE-LEVEL TEST: the gate's whole value is in its WIRING, not
// in its three-line body — `afterSample` is trivially correct, but a channel
// that forgets to use it silently reintroduces the bug (an IPC caller observing
// `competitions-index.json` before the background sample copy has landed in it,
// which for `storage-init` means photo-helper rewriting an index that only
// LOOKS empty). `main.js` is the Electron main-process entry point and cannot be
// `require`d here — it pulls in `electron` and calls `app.whenReady()` at module
// scope, which is exactly why vitest.config.js scopes this suite to `lib/`. So
// the wiring is asserted against the source text instead.
//
// The e2e counterpart (`e2e/sample.spec.ts`) exercises the gate for real, but it
// self-skips whenever no sample is bundled — which is every CI run and every
// checkout with an empty `sample-data/`. This file is the check that still runs
// there, and unlike the e2e it is deterministic rather than a race the copy
// usually loses.
//
// NOTE, so nobody reads more protection into this than exists: no CI workflow
// runs vitest at all today (`.github/workflows/e2e.yml` runs Playwright, and
// that spec self-skips). Until a unit-test job exists, BOTH halves of this
// gate's coverage run only when someone executes them locally.
//
// If you legitimately add or rename a gated channel, update GATED_CHANNELS —
// that edit is the point: it makes the RULE in main.js reviewable.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'main.js');
const source = fs.readFileSync(MAIN_JS, 'utf8');

// Every IPC channel that reads `competitions-index.json` or the
// `.sample-pending` marker, with the reason it must wait for the copy.
const GATED_CHANNELS = [
  ['competition-list', "the launcher's first call and map-corridors' App.tsx mount call"],
  ['storage-init', 'the first call every sub-app makes; photo-helper rewrites an empty-looking index'],
  ['navigate-to-app', 'reads the index for the discipline query string'],
  ['sample-is-pending', 'reads the `.sample-pending` marker the copy writes'],
  ['sample-clear-pending', 'clearing the marker before the copy wrote it would strand the import'],
];

describe('afterSample gate wiring (main.js)', () => {
  it.each(GATED_CHANNELS)('registers %s through afterSample (%s)', (channel) => {
    // Whitespace-tolerant so reformatting the registration does not fail the
    // test, but strict about the wrapper actually being `afterSample`.
    const registration = new RegExp(`safeHandle\\(\\s*'${channel}'\\s*,\\s*afterSample\\(`);
    expect(source).toMatch(registration);
  });

  it('awaits sampleReady inside afterSample', () => {
    // The body between `function afterSample(` and the next top-level `function`
    // declaration — enough to prove the await is there rather than, say, a
    // fire-and-forget `void sampleReady`.
    const body = source.slice(source.indexOf('function afterSample('));
    expect(body.slice(0, body.indexOf('\n}'))).toMatch(/await\s+sampleReady/);
  });

  it('initialises sampleReady to an already-resolved promise', () => {
    // A gated handler that fires before `startSampleCompetition()` ran — or
    // after it threw — must return, not hang forever on a pending promise.
    expect(source).toMatch(/let\s+sampleReady\s*=\s*Promise\.resolve\(/);
  });
});
