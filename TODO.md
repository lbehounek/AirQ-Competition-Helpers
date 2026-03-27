# TODO

## Done (2026-03-27)

- ~~GitHub Actions update~~ — updated release body text, shared-storage works with existing CI
- ~~Competition name in Photo Placement toolbar~~ — shows Chip with competition name
- ~~Cleanup banner in launcher~~ — detects competitions >30 days old or >10 total
- ~~Unified competition management~~ — launcher is source of truth, URL param routing
- ~~App renames~~ — Photo Editor / Photo Placement (Foto editor / Umístění fotek)
- ~~Shared storage package~~ — @airq/shared-storage workspace package
- ~~Nav buttons in sub-apps~~ — Home + app switcher
- ~~Language switcher removed from sub-apps~~ — launcher-only
- ~~Visual consistency~~ — flat #1565C0 header, matching layout

## Remaining

1. **Firebase hosting setup** — move web deployment from site.eu to Firebase Hosting; currently uses SSH/rsync via `deployment/` scripts
2. **Web standalone experience** — photo-helper works standalone with its own selector; map-corridors in web mode has no competition UI (flat session only)
