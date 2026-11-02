# Build from source

## Requirements

- macOS 13 or newer on Apple Silicon for the shipped app.
- Node.js 24 LTS recommended; minimum 22.12.0.
- npm, Git and standard macOS tools (`codesign`, `ditto`, `rsync`).

```bash
git clone https://github.com/kvianAR/BlazeSync.git
cd BlazeSync
npm ci
npm test
npm run build
npm start
```

Quit an already-running installed instance first. Normal `npm start` uses the app's standard local profile; use `npm run smoke` for an isolated synthetic test profile.

## Package and update the same app

```bash
npm run package
# Quit any running BlazeSync instance before the next command.
npm run update-app
open outputs/BlazeSync.app
```

The packager creates a temporary candidate under `work/package-staging`, signs it locally and verifies the signature. The updater refuses to overwrite a running app, updates the existing `outputs/BlazeSync.app` directory, verifies the signature, and removes staging and old generated app backups. It does not change the separately stored connection or preferences. The build is not Apple-notarized.

## Code map

| Location | Responsibility |
| --- | --- |
| `electron/main.cjs` | Desktop lifecycle, S3 operations, transfer queue and backups |
| `electron/preload.cjs` | Narrow renderer IPC interface and native file paths |
| `electron/connection.cjs` | B2 authorization discovery and connection health |
| `electron/folder-metrics.cjs` | Recursive, paginated current-object sizes |
| `electron/cloud-history.cjs` | Versions, delete markers and verified purge |
| `electron/files.cjs` | Folder traversal, safe paths and progress helpers |
| `src/main.jsx` | Full file-manager interface |
| `src/tray.jsx` | macOS menu-bar panel |
| `src/quiet.css` | Semantic light/dark design tokens |
| `scripts/` | Packaging, same-app update and release installer |
| `tests/` | Unit and regression coverage |

The project is independent code using documented B2 APIs. Cyberduck is a reference product; no Cyberduck source or packaged resources are included.
