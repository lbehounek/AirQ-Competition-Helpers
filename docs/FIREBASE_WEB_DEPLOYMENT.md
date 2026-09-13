# Firebase Web Deployment — Plan

**Status:** Approved — Phase 1 can begin
**Branch:** `feat/firebase-web-deployment`
**Owner:** Lukáš
**Date:** 2026-04-18 (rev 2 — unified ops architecture)
**Related:** PR #42 (map providers), PR #44 (backend removal), PR #45 (protocol-buffers-schema patch)
**Firebase project:** `airq-competition-helpers`

---

## 1. Context

AirQ Competition Helpers currently ships as a single Windows `.exe` (Electron)
bundling two React sub-apps plus a native launcher. The sub-apps are already
client-only (OPFS storage, no backend) after PR #44 removed the legacy
FastAPI server. The architecture already supports web deployment — the Vite
configs still define web base paths (`/photo-helper/`, `/map-corridors/`) and
`@airq/shared-storage` auto-picks OPFS in the browser.

This plan adds a second distribution channel: **Firebase Hosting static
deployment**, with full feature parity against the desktop launcher
(competition CRUD, discipline toggle, cleanup suggestions, i18n). Goals are
cheap, easy, and good for testing via preview channels.

## 2. Goals

1. Deploy the application to Firebase Hosting at a public URL.
2. Provide a **web landing page** with the same functionality as the Electron
   launcher: competition list + create/delete/switch + rally/precision toggle
   + cleanup suggestions + cs/en i18n.
3. Retain the sub-apps (`photo-helper`, `map-corridors`) as web-deployable
   SPAs at `/photo-helper/` and `/map-corridors/`, with full feature parity
   against their Electron behaviour.
4. Automate deployment via GitHub Actions:
   - PR opened/updated → preview channel, URL commented on PR
   - Merge to `main` → production channel
5. Preserve desktop build entirely — no regressions to the `.exe` path.
6. Separate Mapbox/Mapy tokens for desktop (unrestricted, baked into `.exe`)
   and web (URL-restricted, in GH Actions secrets).

## 3. Non-goals

- **Auth / multi-user.** Everything stays single-user client-side. No login.
- **Cross-device sync.** OPFS is per-browser; we do not sync competitions
  between devices. Users who want that keep using the desktop `.exe` +
  export/import (future work).
- **Custom domain.** Start with the free `*.web.app` subdomain; custom
  domain can be added later via Firebase console without code changes.
- **PWA / offline install.** Out of scope for v1. Static assets will cache
  via long-lived headers, which is 90% of the benefit.
- **Merging the desktop launcher and web landing codebases.** Possible
  future work, but for v1 we keep them separate. See §9 for rationale.
- **Electron token dialog changes.** The Mapbox/Mapy "Settings" menu items
  continue to work desktop-only, unchanged.

## 4. Architecture Decisions

### 4.1 Hosting target: Firebase Hosting (Spark / free tier)

| Consideration | Firebase Hosting | Alternatives |
|---|---|---|
| Static SPA with nested base paths | First-class, rewrite rules simple | Netlify/Vercel/Cloudflare all equivalent |
| Preview channels per PR | Built-in `hosting:channel:deploy`, unique URLs, TTL, auto-commented on PR | Netlify has Deploy Previews; Vercel similar |
| Free-tier limits | 10 GB storage / 360 MB egress/day | Comparable |
| CLI + CI | `firebase-tools` + `FirebaseExtended/action-hosting-deploy` | Each alt has their own |
| **Tiebreaker** | Already have `firebase` skill + existing GCP account | — |

**Decision:** Firebase Hosting. Move to Blaze (pay-as-you-go) only if we
exceed the free tier — current bundle size (~4.7 MB total) = ~77
cold-downloads/day cap, comfortable for the target audience.

### 4.2 Site layout: single Firebase site, rewrites for nested SPAs

```
Firebase site root
├── /                          → landing SPA (new)
├── /photo-helper/**           → photo-helper SPA (existing)
└── /map-corridors/**          → map-corridors SPA (existing)
```

Rewrites:

```json
{
  "rewrites": [
    { "source": "/photo-helper/**",  "destination": "/photo-helper/index.html"  },
    { "source": "/map-corridors/**", "destination": "/map-corridors/index.html" }
  ]
}
```

The landing SPA at `/` needs no rewrite — it serves `index.html` by default
and hash-less routing is not used.

**Alternative considered:** multi-site Firebase hosting (three separate
sites: `airq-landing`, `airq-photo-helper`, `airq-map-corridors`). Rejected
because:
- OPFS is per-origin — three sites means three isolated competitions stores,
  defeating the point of the landing page.
- Preview channel URLs would be 3× as many to manage.
- No compliance/isolation benefit for this app.

### 4.3 Landing page: new React workspace package `@airq/landing`

The existing Electron launcher (`frontend/desktop/renderer/app.js`) is
vanilla JS + hand-rolled translations + direct `window.electronAPI.*` calls.
Porting it to web has two paths:

**Option A — Vanilla JS on web, keep Electron launcher separate.**
- Pros: minimum code, faster to ship.
- Cons: duplicate UI logic between desktop and web; translation drift risk;
  no component reuse with sub-apps; TypeScript only where convenient.

**Option B — React (Vite + MUI to match sub-apps) in a new workspace package.**
- Pros: shares dependencies, tooling, testing setup with existing apps;
  TypeScript throughout; can later replace the Electron launcher with the
  same codebase (detecting `window.electronAPI` for desktop-only bits);
  reuses `@airq/shared-storage` and (extracted) `CompetitionService` directly.
- Cons: ~1 hour extra scaffolding.

**Decision:** Option B — React. The duplication risk of Option A outweighs
the scaffolding cost, and it gives us a path to unify the launchers later.

### 4.4 Unify competition logic in `@airq/competitions` (pure helpers)

**Context — what exploration revealed (2026-04-18):**

The codebase already has **two implementations of the same store**:

1. `frontend/photo-helper/src/services/competitionService.ts` (615 lines) — a
   browser-side class used by photo-helper. Operates on OPFS (web) or
   Electron IPC-backed filesystem (desktop) via `@airq/shared-storage`.
2. `frontend/desktop/main.js` `ipcMain.handle('competition-*', …)` IPC handlers
   (~150 lines across create / set-active / set-discipline / delete / list /
   cleanup) — Node-side handlers used by the Electron launcher.

Both read/write **the same `competitions-index.json` file** at
`{userData}/photo-sessions/competitions-index.json` (main.js:554,
`competitionService.ts:51`). They already drift: main.js writes a
`discipline: 'rally'` field on metadata that photo-helper's TypeScript
`CompetitionMetadata` type doesn't declare (JSON round-trips preserve it by
accident, not by design).

Adding a third implementation in `frontend/landing/` for the web deploy
would compound the drift risk. CLAUDE.md global rule: "Three copies of the
same pattern is a bug waiting to happen."

**Decision:** Extract the index business logic as **pure functions** into a
new workspace package `@airq/competitions`. Every consumer calls the same
pure helpers; each consumer handles its own I/O.

**Package contents (~300 lines including tests):**

```
frontend/competitions/
├── package.json        — name: @airq/competitions, type: commonjs,
│                         main: ./src/index.js, types: ./src/index.d.ts
├── src/
│   ├── types.ts        — CompetitionMetadata (with `discipline?`),
│   │                     CompetitionsIndex, CleanupCandidate, StorageStats,
│   │                     Competition<TSession>
│   ├── constants.js    — MAX_AGE_DAYS=30, MAX_COMPETITIONS=10,
│   │                     COMPETITIONS_INDEX_FILE='competitions-index.json'
│   ├── ops.js          — pure CompetitionsIndex transformations
│   ├── ops.d.ts        — hand-written type declarations mirroring ops.js
│   ├── index.js        — module.exports aggregator for Node
│   └── index.d.ts      — `export * from './ops'; export * from './types';`
└── __tests__/
    └── ops.test.js     — vitest suite
```

**Pure functions (no I/O, no deps, no side effects):**

| Signature | Purpose |
|---|---|
| `createMetadata({ name, discipline? }): CompetitionMetadata` | Construct metadata with new id + timestamps |
| `addCompetition(index, metadata): CompetitionsIndex` | Append + set active (others inactive) |
| `removeCompetition(index, id): { index, newActiveId }` | Filter out + reassign active |
| `setActive(index, id): CompetitionsIndex` | Toggle isActive + activeCompetitionId |
| `setDiscipline(index, id, discipline): CompetitionsIndex` | Update field + lastModified; throws on invalid |
| `touchCompetition(index, id, updates): CompetitionsIndex` | Generic metadata update (name, lastModified, photoCount) |
| `detectCleanupCandidates(index, { now, maxAgeDays, maxCount }): CleanupCandidate[]` | Age + excess rules (deterministic, injectable clock) |
| `validateIndex(raw): CompetitionsIndex` | Schema-safe parse / normalize; applies defaults to missing fields |
| `emptyIndex(): CompetitionsIndex` | Factory for fresh initialisation |

**Why plain JS for `ops.js` / `constants.js` / `index.js` (not TypeScript):**

- Consumed from three radically different build contexts:
  - photo-helper / map-corridors / landing — Vite-bundled, could read TS natively
  - **Electron `main.js` — raw Node at runtime, cannot consume TypeScript source** without a build step
- Plain JS is universal: Vite imports it, Node `require()`s it, electron-builder
  follows the workspace symlink, pnpm wires it correctly. Zero build tooling.
- Type safety is preserved via hand-written `.d.ts` alongside each `.js`.
  The `.js` and `.d.ts` share the same module name so TS consumers get full
  types; drift between them is caught by `pnpm tsc --noEmit` in
  consumers.
- This is the same pattern `@airq/shared-storage` uses (plain TS-as-source
  today), but tuned for Node consumability by emitting JS+`.d.ts` pairs.

**Why not `@airq/shared-storage`?** That package is the I/O abstraction
(OPFS vs Electron IPC). Competition domain logic is a layer higher — mixing
would couple storage primitives to metadata semantics.

**Why not a build step with `tsc` → `dist/`?**
- Adds a `pnpm --filter @airq/competitions build` to every clean-clone /
  CI run
- Risks electron-builder bundling confusion (CJS vs ESM dual-package hazard
  for Node)
- Forces source-vs-compiled-output drift awareness
- The module is pure functions with few exports — writing JS + `.d.ts`
  directly is lower overhead than the tsc pipeline

**Consumer shape after unification:**

| Consumer | I/O layer kept | Ops imported |
|---|---|---|
| `photo-helper`'s `CompetitionService` (~615 → ~500 lines) | OPFS / ElectronStorage; photo-level `saveSessionPhotos` / `loadSessionPhotos` / session sanitisation | All index mutations |
| `desktop/main.js` IPC handlers (~150 → ~80 lines) | Node `fs` sync reads/writes of `competitions-index.json` | All index mutations |
| `landing` (Phase 2, new) | OPFS only (web single-origin) | All index mutations + its own thin empty-session writer |

Schema invariants live in one place. Changing `MAX_AGE_DAYS`, adding a
metadata field, or bumping index `version` is a one-file edit plus test
update.

**Migration safety:** The only schema change in Phase 1 is making
`discipline?: 'precision' | 'rally'` a declared optional field on
`CompetitionMetadata`. Existing index files without `discipline` continue
to load (field is optional). When `photo-helper.CompetitionService.createCompetition`
now defaults to `discipline: 'rally'` (matching main.js's behaviour), both
sides produce identical metadata going forward. No version bump needed; no
migration code needed.

### 4.5 Token strategy: two tokens per provider

Confirmed decision from chat review:

| Token | Target | Restrictions |
|---|---|---|
| `AirQ Desktop` (Mapbox) | Local `.env` → baked into `.exe` | Public scopes only (`styles:tiles`, `styles:read`, `fonts:read`, `datasets:read`), **no URL allowlist** |
| `AirQ Web – Firebase` (Mapbox) | GH Actions secret | Same scopes + URL-restricted to `*.web.app`, `*.firebaseapp.com`, + custom domain |
| `AirQ Desktop` (Mapy.com) | Local `.env` | Unrestricted, IP rate-limit only |
| `AirQ Web – Firebase` (Mapy.com) | GH Actions secret | Domain-restricted to Firebase hosts |

Rationale: the desktop `.exe` cannot use URL restriction because Electron
serves pages from `app://` (main.js:72-155), which Mapbox/Mapy allowlists do
not officially support. Web deployment at a fixed `*.web.app` origin can
use proper URL restriction. Separating tokens also allows independent
rotation and independent rate-limit caps.

### 4.6 Deployment trigger & channel strategy

| Event | Action |
|---|---|
| PR opened / updated | Build → deploy to preview channel `pr-{number}` (7-day TTL); bot comments URL |
| Push to `main` | Build → deploy to `live` channel (= production) |
| Manual via `workflow_dispatch` | Deploy to ad-hoc channel named by input |

Tags (`desktop-v*`) do **not** trigger web deploys — those stay on the
desktop workflow. Web deploys track `main` continuously.

## 5. Phased Implementation

Each phase ends with a verification step. Merge when all phases pass CI.

### Phase 1 — Create `@airq/competitions` + unify photo-helper and main.js

**Goal:** One canonical implementation of the competitions-index business
logic. Pure functions + types. photo-helper and main.js both call them.

#### 1.1 Scaffold the workspace package

- Create `frontend/competitions/package.json`:
  ```json
  {
    "name": "@airq/competitions",
    "version": "1.0.0",
    "private": true,
    "type": "commonjs",
    "main": "./src/index.js",
    "types": "./src/index.d.ts",
    "exports": {
      ".": {
        "types": "./src/index.d.ts",
        "default": "./src/index.js"
      }
    },
    "scripts": {
      "test": "vitest run",
      "typecheck": "tsc --noEmit"
    },
    "devDependencies": {
      "typescript": "~5.8.3",
      "vitest": "<exact>"
    }
  }
  ```
- Create `frontend/competitions/tsconfig.json` (mirrors
  `shared-storage/tsconfig.json` but allows `.d.ts` + `.js` co-location):
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "lib": ["ES2022", "DOM", "DOM.Iterable"],
      "module": "ESNext",
      "moduleResolution": "bundler",
      "allowImportingTsExtensions": true,
      "allowJs": true,
      "checkJs": false,
      "verbatimModuleSyntax": true,
      "moduleDetection": "force",
      "noEmit": true,
      "strict": true,
      "skipLibCheck": true,
      "noUnusedLocals": true,
      "noUnusedParameters": true
    },
    "include": ["src"]
  }
  ```
- Add `competitions` to `frontend/pnpm-workspace.yaml` packages list
  (alongside `shared-storage`, `photo-helper`, `map-corridors`, `desktop`).

#### 1.2 Write `src/types.ts`

- Move + extend `photo-helper/src/types/competition.ts` content:
  - `CompetitionMetadata` adds `discipline?: 'precision' | 'rally'`
  - `Competition` becomes `Competition<TSession = unknown>` (parametrised;
    photo-helper passes `ApiPhotoSession`, landing passes its own shape, ops
    module doesn't care)
  - Keep `CleanupCandidate`, `CleanupSuggestion`, `StorageStats`,
    `CompetitionsIndex`, `CleanupAction`
  - Add a `Discipline = 'precision' | 'rally'` union for reuse

#### 1.3 Write `src/constants.js` + `src/constants.d.ts`

```js
// constants.js
exports.MAX_AGE_DAYS = 30;
exports.MAX_COMPETITIONS = 10;
exports.COMPETITIONS_INDEX_FILE = 'competitions-index.json';
exports.DEFAULT_DISCIPLINE = 'rally';
exports.VALID_DISCIPLINES = Object.freeze(['precision', 'rally']);
```

```ts
// constants.d.ts
export const MAX_AGE_DAYS: number;
export const MAX_COMPETITIONS: number;
export const COMPETITIONS_INDEX_FILE: string;
export const DEFAULT_DISCIPLINE: 'rally';
export const VALID_DISCIPLINES: readonly ['precision', 'rally'];
```

#### 1.4 Write `src/ops.js` + `src/ops.d.ts`

Pure functions. No `console.log`, no I/O, no `Date.now()` without injection
(tests pass `now` as an arg to `detectCleanupCandidates` for determinism).

```js
// ops.js (excerpt)
const { DEFAULT_DISCIPLINE, MAX_AGE_DAYS, MAX_COMPETITIONS, VALID_DISCIPLINES } = require('./constants');

function generateId() {
  return `comp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createMetadata({ name, discipline = DEFAULT_DISCIPLINE, now = new Date().toISOString() } = {}) {
  if (!name) throw new Error('createMetadata: name required');
  if (!VALID_DISCIPLINES.includes(discipline)) {
    throw new Error(`createMetadata: invalid discipline ${discipline}`);
  }
  return {
    id: generateId(),
    name,
    discipline,
    createdAt: now,
    lastModified: now,
    photoCount: 0,
    isActive: true,
  };
}

function addCompetition(index, metadata) {
  const competitions = index.competitions.map(c => ({ ...c, isActive: false }));
  competitions.push({ ...metadata, isActive: true });
  return { ...index, competitions, activeCompetitionId: metadata.id };
}

function removeCompetition(index, id) {
  const competitions = index.competitions.filter(c => c.id !== id);
  let activeCompetitionId = index.activeCompetitionId;
  if (activeCompetitionId === id) {
    activeCompetitionId = competitions[0]?.id ?? null;
    if (competitions[0]) competitions[0].isActive = true;
  }
  return { ...index, competitions, activeCompetitionId };
}

function setActive(index, id) {
  const found = index.competitions.find(c => c.id === id);
  if (!found) throw new Error(`setActive: competition not found ${id}`);
  const competitions = index.competitions.map(c => ({ ...c, isActive: c.id === id }));
  return { ...index, competitions, activeCompetitionId: id };
}

function setDiscipline(index, id, discipline, { now = new Date().toISOString() } = {}) {
  if (!VALID_DISCIPLINES.includes(discipline)) {
    throw new Error(`setDiscipline: invalid discipline ${discipline}`);
  }
  const found = index.competitions.find(c => c.id === id);
  if (!found) throw new Error(`setDiscipline: competition not found ${id}`);
  const competitions = index.competitions.map(c =>
    c.id === id ? { ...c, discipline, lastModified: now } : c
  );
  return { ...index, competitions };
}

function touchCompetition(index, id, patch, { now = new Date().toISOString() } = {}) {
  const found = index.competitions.find(c => c.id === id);
  if (!found) throw new Error(`touchCompetition: competition not found ${id}`);
  const competitions = index.competitions.map(c =>
    c.id === id ? { ...c, ...patch, lastModified: now } : c
  );
  return { ...index, competitions };
}

function detectCleanupCandidates(index, { now = Date.now(), maxAgeDays = MAX_AGE_DAYS, maxCount = MAX_COMPETITIONS } = {}) {
  const ageThresholdMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const byAge = index.competitions.filter(c => (now - new Date(c.createdAt).getTime()) > ageThresholdMs);
  const byExcess = index.competitions.length > maxCount
    ? [...index.competitions]
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .slice(0, index.competitions.length - maxCount)
    : [];
  const seen = new Set();
  const out = [];
  for (const c of byAge) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({
      competition: c,
      reason: 'age',
      daysOld: Math.floor((now - new Date(c.createdAt).getTime()) / (24 * 60 * 60 * 1000)),
    });
  }
  for (const c of byExcess) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({ competition: c, reason: 'excess' });
  }
  return out;
}

function validateIndex(raw) {
  if (!raw || typeof raw !== 'object') return emptyIndex();
  const competitions = Array.isArray(raw.competitions) ? raw.competitions : [];
  return {
    competitions,
    activeCompetitionId: typeof raw.activeCompetitionId === 'string' ? raw.activeCompetitionId : null,
    version: typeof raw.version === 'number' ? raw.version : 1,
  };
}

function emptyIndex() {
  return { competitions: [], activeCompetitionId: null, version: 1 };
}

module.exports = {
  createMetadata, addCompetition, removeCompetition, setActive, setDiscipline,
  touchCompetition, detectCleanupCandidates, validateIndex, emptyIndex,
};
```

Mirror signatures in `ops.d.ts`.

#### 1.5 Write `src/index.js` + `src/index.d.ts`

Aggregator:
```js
// index.js
module.exports = { ...require('./ops'), ...require('./constants') };
```
```ts
// index.d.ts
export * from './ops';
export * from './constants';
export * from './types';
```

#### 1.6 Write tests `__tests__/ops.test.js`

Vitest. Deterministic (inject `now`). Cases:
- `createMetadata` — valid fields, defaults to `rally`, rejects invalid
  discipline, includes generated `id`
- `addCompetition` — new entry is active, others become inactive,
  `activeCompetitionId` updated
- `removeCompetition` — removing active entry reassigns to first remaining,
  null when list empties
- `setActive` — throws on unknown id
- `setDiscipline` — writes field + `lastModified`, rejects invalid
- `detectCleanupCandidates` — age only, excess only, overlap (dedupes), empty list
- `validateIndex` — missing fields fall back to defaults, preserves unknown fields

~60 lines of tests. Run via `pnpm --filter @airq/competitions test`.

#### 1.7 Rewire `photo-helper/src/services/competitionService.ts`

- Add dependency `"@airq/competitions": "workspace:*"` to
  `frontend/photo-helper/package.json`.
- Replace types import:
  ```ts
  import type { Competition, CompetitionMetadata, CompetitionsIndex, CleanupCandidate, StorageStats } from '@airq/competitions';
  ```
- Replace inline index manipulations with ops:
  - `createCompetition`: use `ops.createMetadata({ name, discipline: 'rally' })` and `ops.addCompetition(index, metadata)`
  - `deleteCompetition`: use `ops.removeCompetition(index, id)`; keep the FS I/O (clear dir) around it
  - `setActiveCompetition`: use `ops.setActive(index, id)`
  - `detectCleanupCandidates`: delegate to `ops.detectCleanupCandidates` (retain `estimatedSizeMB` enrichment via storage walk)
  - `getCompetitionsIndex`: use `ops.validateIndex` on raw parse, `ops.emptyIndex` when missing
  - `updateCompetition` (touching `name` / `lastModified` / `photoCount`): use `ops.touchCompetition`
- Remove duplicated constants (`MAX_AGE_DAYS`, `MAX_COMPETITIONS`, `COMPETITIONS_INDEX_FILE`) — import from ops.
- Also update `components/CompetitionSelector.tsx`, `components/CleanupModal.tsx`,
  `components/CreateCompetitionButton.tsx`, `hooks/useCompetitionSystem.ts`,
  `services/migrationService.ts` to import types from `@airq/competitions`
  instead of `../types/competition`.
- Delete `photo-helper/src/types/competition.ts` (fully superseded).

#### 1.8 Rewire `desktop/main.js` competition IPC handlers

- Add dependency `"@airq/competitions": "workspace:*"` to
  `frontend/desktop/package.json` (currently has no `dependencies` block —
  create one).
- Top of `main.js`:
  ```js
  const competitionsOps = require('@airq/competitions');
  ```
- Replace inline logic in `competition-create`, `competition-set-active`,
  `competition-set-discipline`, `competition-delete`, `competition-list`,
  `competition-cleanup-needed`, `competition-cleanup-perform` (whichever
  exist in main.js today) with the corresponding ops calls.
- Keep: path validation (`validateStoragePath`, `sanitizeFileName`),
  directory creation/removal via `fs`, empty-session JSON writing (empty
  session shape stays in main.js — landing writes its own copy, photo-helper
  creates via its own service; this is deliberate, see §4.4 "Migration
  safety").

#### 1.9 electron-builder bundling verification

Concern: `@airq/competitions` is a workspace symlink. electron-builder must
pick it up so `main.js`'s `require('@airq/competitions')` resolves at
runtime inside the packaged `.exe`.

- Check `frontend/desktop/package.json` `build.files` — currently only
  ships `main.js`, `preload.js`, `renderer/**/*`. Workspace deps normally
  resolve via `node_modules` symlink chain. electron-builder's
  node-modules handling traverses `dependencies` declared in
  `desktop/package.json` — hence the `"@airq/competitions": "workspace:*"`
  line.
- Verify after build: `unzip -l dist/photo-helper-v2.6.3.exe | grep competitions`
  or inspect `dist/win-unpacked/resources/app.asar` for the package path.
- If missing, add to `build.files`: `"node_modules/@airq/**"`.

#### 1.10 Phase 1 verification gate — do not proceed past this

1. `pnpm --filter @airq/competitions test` — all ops tests pass
2. `pnpm --filter @airq/competitions typecheck` — clean
3. `pnpm install --frozen-lockfile` — after initial unfrozen install that
   generates the lockfile; freeze-verify it
4. `pnpm --filter @airq/photo-helper exec tsc --noEmit` — clean
5. `pnpm --filter @airq/photo-helper exec vitest run` — **54/54 pass**
6. `pnpm --filter @airq/map-corridors exec tsc --noEmit` — clean (no changes
   expected but worth checking)
7. `pnpm --filter @airq/map-corridors exec vitest run` — **132/132 pass**
8. `bash frontend/desktop/build.sh` — builds without error
9. **Manual test of built `.exe`** (critical, not automatable):
   - Launch `dist/win-unpacked/AirQ Competition Helpers.exe`
   - Launcher loads, existing competitions appear in select
   - Create a new competition → appears immediately, sets as active
   - Toggle discipline rally → precision → persists after restart
   - Open Photo Editor → same competition is active, discipline matches URL
   - Open Map Corridors → same competition is active, discipline matches URL
   - Delete a competition → disappears, next entry becomes active
   - Language switch (cs/en) still works
10. Only after all 10 checks pass: commit "feat(competitions): extract
    pure ops package and unify photo-helper + main.js" on the feature
    branch. Do not proceed to Phase 2 until committed.

### Phase 2 — New `@airq/landing` React app

1. Scaffold `frontend/landing/` mirroring `frontend/map-corridors/` conventions
   (Vite + React + TS + MUI + same `envDir` pointing to repo root). Include
   `@airq/competitions` and `@airq/shared-storage` as workspace dependencies.
2. Vite base: `'/'` for production. Desktop future use is explicitly
   deferred (non-goal §3).
3. **Thin OPFS storage adapter** (`src/services/landingStorage.ts`, ~80
   lines) — not a duplicate of photo-helper's service. Responsibilities:
   - Init OPFS root via `initStorage()` from `@airq/shared-storage`
   - `readCompetitionsIndex()` → `CompetitionsIndex` via `ops.validateIndex`
   - `writeCompetitionsIndex(index)` — atomic JSON write
   - `createCompetitionDir(id)` + `writeEmptySession(id, name)` — writes an
     empty `session.json` matching the shape photo-helper expects
     (`frontend/desktop/main.js:595-614`). That shape is **duplicated** from
     main.js intentionally; the alternative is extracting a full session
     factory to `@airq/competitions`, which drags `ApiPhotoSession` and
     therefore `Photo` (canvas state) into the shared package — photo-helper
     domain that landing does not need to evolve with. Acceptable scope: the
     empty-session shape is small, stable, and tested by the sub-apps
     loading it.
   - `deleteCompetitionDir(id)` — recursive clear via shared-storage
4. **UI components** (React + MUI; TypeScript throughout):
   - `CompetitionSelector` — MUI `Select`, shows list + active indicator
   - `CreateCompetitionInline` — inline form (name input + confirm/cancel),
     matches the Electron launcher's inline UX rather than a modal
   - `DeleteConfirmationInline` — inline confirm with the competition name
   - `DisciplineToggle` — segmented buttons (rally / precision), calls
     `ops.setDiscipline` → write index
   - `CleanupBanner` — uses `ops.detectCleanupCandidates`; matches existing
     strings (`competition.cleanupMsg` / `competition.cleanupExcess`)
   - `AppCard` — two cards (Photo Editor, Photo Placement) navigating to
     `/photo-helper/?competitionId=…&discipline=…` and `/map-corridors/?…`
   - `LanguageSwitcher` — cs/en, persists via `localStorage` (no
     `electronAPI` on web)
   - `BrowserSupportGate` — early check for OPFS availability; renders
     fallback page if missing
5. **i18n**: port the translations object from
   `frontend/desktop/renderer/app.js:2-51` verbatim into
   `src/locales/cs.json` + `src/locales/en.json`. Use `react-i18next` (match
   the photo-helper/map-corridors pattern if they use it, or bespoke context
   if they don't — verify during scaffolding). Language persists in
   `localStorage`, initial load defaults to `cs`.
6. **Styling**: port `frontend/desktop/renderer/styles.css` as the starting
   visual language. Migrate progressively to MUI theme tokens where natural
   (colors, spacing); custom rules stay in a scoped `.css` where MUI doesn't
   fit (e.g., the card hover animation).
7. **Navigation behaviour parity with Electron launcher**:
   - Active competition id and discipline both flow through URL params to
     sub-apps (same pattern main.js:232-253 uses)
   - Cards disabled until a competition is selected (matches Electron
     launcher's `updateCardsState`)
8. **Tests**: happy-path vitest suite for `landingStorage` using OPFS in
   jsdom / happy-dom (or mock storage). Component tests optional for v1 —
   the service + ops layer is the fragile part.
9. **Verify**: `pnpm --filter @airq/landing dev` boots; can create/switch/
   delete/discipline-toggle competitions; navigation to `/photo-helper/`
   works when running all three Vite dev servers in parallel OR by
   previewing the production bundle locally.

**Phase 2 gate:** landing dev server exercises the full flow against real
OPFS. Only then does Phase 3 (Firebase wiring) start.

### Phase 3 — `firebase.json` + local deploy dry-run

1. `firebase init hosting` from repo root (user provides Firebase project ID).
2. Write `firebase.json`:
   ```json
   {
     "hosting": {
       "public": "public",
       "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
       "rewrites": [
         { "source": "/photo-helper/**",  "destination": "/photo-helper/index.html"  },
         { "source": "/map-corridors/**", "destination": "/map-corridors/index.html" }
       ],
       "headers": [
         { "source": "**/*.@(js|css|woff2|png|jpg|jpeg|svg|ico)",
           "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
         { "source": "**/index.html",
           "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
         { "source": "**",
           "headers": [
             { "key": "X-Content-Type-Options", "value": "nosniff" },
             { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
           ] }
       ]
     }
   }
   ```
3. Write a build script `scripts/build-web.sh`:
   ```bash
   #!/usr/bin/env bash
   set -e
   cd frontend && pnpm install --frozen-lockfile
   pnpm --filter @airq/photo-helper build
   pnpm --filter @airq/map-corridors build
   pnpm --filter @airq/landing build
   cd ..
   rm -rf public
   mkdir -p public
   cp -r frontend/landing/dist/*           public/
   cp -r frontend/photo-helper/dist        public/photo-helper
   cp -r frontend/map-corridors/dist       public/map-corridors
   ```
4. Verify: `bash scripts/build-web.sh && firebase emulators:start --only hosting`
   → test landing + both sub-apps in browser at `http://localhost:5000/`.
5. Dry-run real deploy: `firebase hosting:channel:deploy dryrun-local`
   (only after project created by user and CLI auth works).

### Phase 4 — GitHub Actions workflow

`.github/workflows/build-web.yml`:

- Trigger: `pull_request` (opened, synchronize, reopened) on `main`;
  `push` on `main`; `workflow_dispatch`.
- Steps (all actions **SHA-pinned** per `sec--github-security` rule):
  1. `actions/checkout@<sha>`
  2. `pnpm/action-setup@<sha>` v10
  3. `actions/setup-node@<sha>` v20 with pnpm cache
  4. `pnpm install --frozen-lockfile` (per supply-chain rule)
  5. Build sub-apps and landing with `VITE_MAPBOX_TOKEN` and
     `VITE_MAPYCZ_TOKEN` from GH secrets (web-restricted tokens)
  6. Assemble `public/` via the same script
  7. On PR → `FirebaseExtended/action-hosting-deploy@<sha>` with
     `channelId: pr-${{ github.event.pull_request.number }}`,
     expires 7 days; `projectId`, service-account key from secret.
  8. On push to `main` → same action with `channelId: live`.
- New GH secrets needed (listed in §6).

### Phase 5 — Token creation, domain allowlist, first real deploy

1. User creates Firebase project (sign-off gate).
2. User creates the 4 new tokens (Mapbox web, Mapy web) with URL
   restrictions matching the Firebase domains; provides them as GH secrets.
3. Open PR → verify preview channel URL works end-to-end (maps render,
   can create competition, can navigate between apps).
4. Merge PR → verify production deploy.
5. Add follow-up task to soften CHANGELOG `[2.6.1]` wording
   ("Electron-only distribution") when we cut `2.7.0` with the web deploy.

### Phase 6 — Documentation & cleanup

1. Add `docs/WEB_DEPLOYMENT.md` with:
   - How to deploy manually (CLI)
   - How to add a new domain to Mapbox/Mapy allowlists
   - Preview channel URL format and TTL
   - Troubleshooting OPFS / token / CORS
2. Update `README.md` with a "Try it online" link to the production URL.
3. Add a skill `windows-app` sibling — maybe `web-app` — if the flow needs
   documenting beyond the plan doc. TBD.
4. Close this plan (move to `docs/archive/` or mark `Status: Shipped`).

## 6. Concrete File Changes Summary

**New files — `@airq/competitions` (pure ops package, ~300 lines):**
- `frontend/competitions/package.json` — workspace package, `"type": "commonjs"`, no build step
- `frontend/competitions/tsconfig.json` — allowJs + checkJs, noEmit
- `frontend/competitions/src/types.ts` — `CompetitionMetadata` (+ `discipline`), `CompetitionsIndex`, `Competition<T>`, `CleanupCandidate`, `StorageStats`, `Discipline`
- `frontend/competitions/src/constants.js` — `MAX_AGE_DAYS`, `MAX_COMPETITIONS`, `COMPETITIONS_INDEX_FILE`, `DEFAULT_DISCIPLINE`, `VALID_DISCIPLINES`
- `frontend/competitions/src/constants.d.ts` — declarations mirroring constants.js
- `frontend/competitions/src/ops.js` — pure functions
- `frontend/competitions/src/ops.d.ts` — declarations mirroring ops.js
- `frontend/competitions/src/index.js` — Node aggregator (`module.exports = { ...ops, ...constants }`)
- `frontend/competitions/src/index.d.ts` — TS aggregator (`export * from './ops'; export * from './constants'; export * from './types';`)
- `frontend/competitions/__tests__/ops.test.js` — vitest suite

**New files — `@airq/landing` (Vite/React app):**
- `frontend/landing/` — entire new Vite/React app (scaffolded like `map-corridors`)
- `firebase.json` — hosting config
- `.firebaserc` — project ID pointer (user provides)
- `scripts/build-web.sh` — orchestrates the three builds into `public/`
- `.github/workflows/build-web.yml` — CI/CD
- `docs/WEB_DEPLOYMENT.md` — operational docs

**Modified files:**
- `frontend/pnpm-workspace.yaml` — include `competitions`, `landing` (if explicit)
- `frontend/photo-helper/package.json` — add `@airq/competitions` dependency
- `frontend/photo-helper/src/hooks/useCompetitionSystem.ts` — import path update
- `frontend/photo-helper/src/AppApi.tsx` — import path update (if any)
- `.gitignore` — add `public/` (build output), `.firebase/` (cache)
- `CHANGELOG.md` — prepare `[2.7.0]` entry for the web launch
- `README.md` — add "Try it online" section

**Unchanged:**
- `frontend/desktop/*` — Electron launcher stays exactly as-is
- `frontend/photo-helper/src/*` except import paths — logic unchanged
- `frontend/map-corridors/src/*` — no changes
- `frontend/shared-storage/*` — no changes
- `.github/workflows/build-desktop.yml` — no changes

## 7. New GitHub Actions Secrets

To be added by user before Phase 5:

- `FIREBASE_SERVICE_ACCOUNT_AIRQ` — JSON key for the Firebase service account
  (from Firebase console → Project settings → Service accounts). Used by
  `FirebaseExtended/action-hosting-deploy`.
- `VITE_MAPBOX_TOKEN_WEB` — URL-restricted Mapbox token.
- `VITE_MAPYCZ_TOKEN_WEB` — URL-restricted Mapy.com token.

(Desktop tokens stay in local `.env` only — never uploaded.)

## 8. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Ops refactor breaks main.js IPC handlers | Medium | High — broken desktop launcher | Phase 1 gate step 9 (manual `.exe` test). Ops unit tests cover index transformations; IPC layer is thin pass-through after refactor. |
| Ops refactor breaks photo-helper's CompetitionService | Medium | High — photo-helper crashes | Same gate. Existing 54/54 vitest suite exercises the service; 132/132 in map-corridors bounds storage-layer regressions. |
| electron-builder can't resolve `@airq/competitions` at runtime | Low | High — `.exe` crashes on launch | Phase 1 step 1.9 verifies with `unzip -l` / `.asar` inspection. Fallback: add `node_modules/@airq/**` to `build.files`. |
| pnpm workspace `workspace:*` spec breaks CI install | Low | Medium | `pnpm install --frozen-lockfile` in CI catches mismatch. First install generates lockfile; subsequent runs validate. |
| Mapbox tile 403 from preview channel subdomain | Medium | Medium — maps don't load | Wildcards `*.web.app` in Mapbox allowlist cover all preview URLs |
| OPFS quota exhaustion on web | Low | Medium | Landing shows `storageStats`; `detectCleanupCandidates` already flags excess |
| Tokens leaked via bundle inspection | High (by design) | Low — scope-restricted | URL restriction on web tokens; rotate if abuse detected |
| GH Actions workflow compromised (Trivy-style tag hijack) | Low | High | All actions **SHA-pinned**; Dependabot monitors SHA versions |
| Free-tier bandwidth exceeded | Low (77 cold downloads/day) | Low (auto-upgrade to Blaze at ~$0.15/GB) | Monitor Firebase console weekly for the first month |
| User browser lacks OPFS | Low (modern browsers only) | Medium — app fails silently | `BrowserSupportGate` component detects + shows fallback page |
| Deep links break between sub-apps on web | Medium | Medium | Each sub-app's `electronAPI`-guarded buttons silently hide; landing provides nav instead |
| Empty-session shape duplicated in main.js and landing | Low | Low (shape is stable) | Both shapes covered by sub-app load tests; if it drifts, loaders fail loudly. Resolution path: extract `createEmptySession(mode)` to `@airq/competitions` if we need to evolve it. |

**Risks eliminated by the unified approach (vs. the original plan):**
- ~~Drift between photo-helper's service and main.js IPC handlers~~ — now
  impossible for index logic; they call the same ops.
- ~~Third implementation in landing duplicating the same logic a third
  time~~ — landing also calls ops.
- ~~`discipline` field undeclared in TypeScript types~~ — now explicit on
  `CompetitionMetadata`.

## 9. Open Questions — Decisions Resolved

All questions resolved 2026-04-18 (user created project, accepted defaults):

1. ✅ **Firebase project ID**: `airq-competition-helpers`.
2. ✅ **Landing styling**: port existing launcher CSS to MUI theme tokens
   where natural; keep the visual language.
3. ✅ **Free tier**: yes for v1. Monitor Firebase console weekly for the
   first month. Upgrade to Blaze only if bandwidth is exceeded.
4. ✅ **Desktop launcher unification**: deferred — explicit non-goal for v1.
   The Phase 1 unified ops package makes a future unification cheap because
   business logic is already shared; only the UI shell would need merging.
5. ✅ **Analytics**: none for v1. Revisit when there are users.
6. ✅ **Custom domain**: `*.web.app` for v1. `~30-minute` follow-up when a
   domain is picked (DNS + Mapbox/Mapy allowlist update).

## 10. Testing Plan

**Before merge:**
- `pnpm -r exec tsc --noEmit` — clean across all packages
- `pnpm -r exec vitest run` — 54 + 132 + any new landing tests pass
- `bash scripts/build-web.sh` — full web bundle builds locally
- `bash frontend/desktop/build.sh portable` — `.exe` still builds and runs
- `firebase emulators:start --only hosting` + manual smoke test:
  - [ ] Landing loads, shows current competitions
  - [ ] Create a competition — appears in list
  - [ ] Switch discipline to precision — persists across page reload
  - [ ] Navigate to photo-helper → sees the same competition
  - [ ] Navigate to map-corridors → sees the same competition
  - [ ] Language switcher persists
  - [ ] Cleanup banner shows correctly when test data has >10 comps
  - [ ] OPFS-unavailable warning shows in incognito with OPFS disabled
- **Browser matrix:** Chrome 108+, Edge 108+, Safari 15.2+, Firefox 111+.
- **Mobile?** Out of scope for v1 — the desktop apps are not mobile-
  friendly anyway. Document as a known limitation.

**Post-deploy preview channel:**
- Preview URL opens without cert warnings
- Mapbox tiles load (proves web token + allowlist work)
- Mapy tiles load (proves the second token path)
- OPFS state is persistent across refresh

**Post-production deploy:**
- Same smoke test on `live` channel
- Analytics baseline (if enabled)

## 11. Rollback / Decommission

- **Rollback per deploy:** `firebase hosting:clone <source>:<channel> <target>:live`
  rolls production back to any previous preview/live revision.
- **Full decommission:** disabling the GH Actions workflow + deleting the
  Firebase site removes web distribution entirely; the desktop `.exe` path
  is 100% independent and unaffected.

## 12. Effort Estimate

Hours-without-AI (baseline): **18–24 hours** (revised upward after
exploration revealed the ops-unification scope)

| Phase | Hours |
|---|---|
| Phase 1 — `@airq/competitions` pure ops + unify photo-helper + unify main.js + `.exe` verification | 3–4 h |
| Phase 2 — Landing React app (scaffold + UI + storage adapter + i18n + tests) | 6–8 h |
| Phase 3 — `firebase.json` + build script + local emulator dry-run | 1–2 h |
| Phase 4 — GitHub Actions workflow (build + preview + live, SHA pins, secret wiring) | 2–3 h |
| Phase 5 — Token creation + allowlist + first real deploy + debug | 1–2 h |
| Browser matrix testing + OPFS feature-detect verification | 1–2 h |
| Phase 6 — `docs/WEB_DEPLOYMENT.md` + README update + CHANGELOG entry | 1 h |
| 2.6.1 "Electron-only distribution" CHANGELOG softening when cutting 2.7.0 | 0.5 h |
| Buffer for unknowns (electron-builder bundling, preview-channel auth edge cases) | 1–2 h |

Hours-with-AI estimate: **5–7 hours** (time arbitrage: ~3.5×). Revised
slightly upward because the unified refactor rewires two production
consumers (photo-helper + main.js) instead of just adding one new one.

**Log via `/time-log` on completion.**

---

## 13. Execution Summary (for the Claude operator)

One-commit-per-phase discipline. Each commit stands alone: tests green,
typecheck clean, manual gate satisfied where applicable. No squash until PR
merge.

1. Phase 1 → commit: `feat(competitions): extract pure ops package, unify photo-helper + main.js`
2. Phase 2 → commit: `feat(landing): React landing app with competition management`
3. Phase 3 → commit: `feat(hosting): firebase.json + build orchestration script`
4. Phase 4 → commit: `ci(web): GitHub Actions workflow with preview channels`
5. Phase 5 → run; commit any fixups if verification caught something
6. Phase 6 → commit: `docs(web): deployment operations guide + CHANGELOG 2.7.0`
7. Open PR (draft) → CI deploys preview → manual smoke test → mark ready
   for review → `/review-pr` → address findings → merge → verify live
   channel → tag if desktop version needs bumping (independent from web
   deploy)

At each phase's verification gate, pause and report status to the user.
Do not chain phases silently.

## Sign-off

- [x] Plan reviewed and approved by owner
- [x] Firebase project created, project ID provided (`airq-competition-helpers`)
- [ ] Decisions on §9 open questions recorded in this doc
- [ ] Phase 1 can begin
