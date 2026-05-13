# Photo Map Culling

A map-driven photo culling tool that sits between photo capture and the
photo editor. Drop a batch of GPS-tagged photos, see them on a map at the
location they were taken, decide which ones to use, and place a pin at the
*subject* location (the actual object in the photo). Selections flow
automatically into both the photo editor (for printing) and the corridor
checker (for legality / answer sheet generation).

Single biggest workflow win in the competition-prep pipeline.

---

## Status

| | |
|---|---|
| Phase | **Design — no code yet** |
| Branch | `docs/photo-map-culling` |
| Target app | `frontend/map-corridors` (extended; not a new app) |
| Depends on | `feat/candidate-photos` merged to `main` |
| Implementation owner | TBD |
| Estimated effort (without AI) | ~5–8 working days |
| First-PR slice | Phase 0 + Phase 1 (types + EXIF pipeline + tests) |

---

## Problem

Today's flow is two unconnected steps:

1. **Cull blind in Explorer.** Organizer shoots 30–100 candidate photos.
   Picks survivors by filename + thumbnail viewer. No map context. Easy to
   confuse photos taken near each other.
2. **Place markers manually.** In map-corridors, organizer clicks the map at
   each photo's *subject location* by eye. The EXIF already knows roughly
   where each photo lives — that information is being re-typed by hand.

Both steps are slow, both are error-prone, and they duplicate latent
geographic information that the camera already captured.

---

## Solution

One tool, one workflow:

```
        ┌─────────────────────────────────────────────────────┐
        │ Camera / phone with GPS                             │
        │ 30–100 photos with EXIF (latitude, longitude, time) │
        └────────────────────────┬────────────────────────────┘
                                 │ drag & drop
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ map-corridors — Photo source mode                                │
│                                                                  │
│   • EXIF GPS → dot at capture location                           │
│   • click dot → thumbnail popup + Include / Skip / Reject        │
│   • for Include: subject pin appears at capture loc, draggable   │
│   • drag the pin to where the object actually is                 │
│   • photos without GPS → dropped along lower map edge by time    │
│   • assign label (A–T Rally / 1–20 Precision)                    │
└─────────┬───────────────────────────────────────┬────────────────┘
          │ chosen photos                         │ same dataset
          ▼                                       ▼
┌──────────────────────────────┐    ┌─────────────────────────────────┐
│ photo-helper (candidate pool)│    │ map-corridors (PhotoMarkers     │
│  Crop, level, label, PDF     │    │  at subject locations) →        │
│                              │    │  legality check, answer sheet   │
└──────────────────────────────┘    └─────────────────────────────────┘
```

Three apps already share the per-competition OPFS/filesystem directory
(`competitions/{compId}/`). Adding photos to that directory makes them
visible everywhere; **no new contract between apps is needed**.

The map tool is not a new app — it's a new **mode** of the existing
map-corridors app (decision recorded in [decisions.md](./decisions.md#adr-001-extend-map-corridors-rather-than-build-a-new-app)).

---

## Out of scope for v1

- **HEIC / HEIF support.** iPhone-default format; not supported in v1.
  Documented as a known limitation. ([ADR-006](./decisions.md#adr-006-no-heic-support-in-v1))
- **Side-by-side compare modal.** Future enhancement.
- **Time-clustering** ("you took 5 photos in 30s, you probably only need one").
- **Keyboard shortcuts.**

---

## Document map

| File | Purpose |
|---|---|
| [README.md](./README.md) | This file. Feature overview + status. |
| [user-stories.md](./user-stories.md) | What the user wants to do, with acceptance criteria per story. |
| [decisions.md](./decisions.md) | ADR-style log of every locked design choice and the alternatives considered. |
| [implementation-plan.md](./implementation-plan.md) | Phased plan with file-level scope, exit criteria, and test focus. |

Read in that order if you're new to the feature.
