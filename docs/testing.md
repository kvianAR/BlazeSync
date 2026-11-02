# Testing and verification

## Run checks

Use Node.js 24 LTS (minimum 22.12.0).

```bash
npm ci
npm test
npm run build
npm audit
```

The automated tests cover connection discovery, recursive folder metrics across more than 1,000 objects, safe filesystem paths, speed/ETA, version pagination and deletion verification, listing refresh, shutdown races, update-process safety and the terminal installer.

## Desktop smoke suite

On a Mac with a desktop session:

```bash
npm run build
npm run smoke
```

The suite launches Electron with a **temporary, isolated profile** and an in-memory S3 protocol fixture. It exercises actual IPC/preload boundaries, connected screens, native drag/drop events, folder upload/download, one-way backups, network recovery, encrypted-key reload, light/dark themes, window/menu-bar lifecycle and a 17 MiB multipart upload. It never uses your saved B2 key or deletes your live cloud files.

Before the public repository preparation, 56 unit/regression tests and 45 packaged-desktop checks passed; including installer regression cases. The repository CI runs the current unit suite, build, dependency audit and packaging checks. Local results do not substitute for testing the exact published ZIP on another Mac.

## Test the release manually

1. Download the ZIP and checksum from the same release; verify the checksum.
2. Quit an existing BlazeSync instance before installing over that app.
3. Open the app and its menu-bar panel. Confirm the Dock behavior.
4. Connect with a dedicated key and a **disposable test bucket**.
5. Upload a folder with nested files and an empty folder. Compare sizes in B2 and BlazeSync.
6. Test current objects versus retained versions. Review destructive confirmations before deleting disposable files.
7. Download a complete folder and compare local content.
8. Test an interrupted transfer, offline recovery and waking the Mac.

Live multi-GB transfers, prolonged outages, retention/legal holds and diverse macOS configurations still require broader testing. Do not assume the source test suite proves those cases.

Demo screenshots under `docs/assets/` use synthetic fixture data, not a private account. Private audit logs, saved app state, generated app bundles and local validation reports are excluded from Git.
