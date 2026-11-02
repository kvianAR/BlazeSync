# Troubleshooting and current limits

## macOS does not open the downloaded app

The download is a locally signed development build, not Apple-notarized. Only download it from [this repository's releases](https://github.com/kvianAR/BlazeSync/releases). If macOS blocks it, review the app in **System Settings → Privacy & Security** and use the platform's **Open Anyway** flow if you trust it. Do not disable Gatekeeper globally. A managed Mac may require its administrator's approval.

The prebuilt app is **Apple Silicon only** and declares **macOS 13 or newer**. It is not an Intel, Windows, Linux or Android build. Other OS clients in design notes are proposals.

## “BlazeSync is still running” during installation

Choose **Quit BlazeSync** from the menu-bar panel, then run the installer/update again. Closing its main window only hides the app. The installer deliberately avoids overwriting an active app.

## App is empty but Backblaze shows a file

Check **Versions & deleted**. B2 can retain an older version behind a latest delete marker. Current files and retained history are different. Refresh both the app and the web console. For permanent removal, use Delete all versions and review the confirmation carefully.

## Folder size says Calculating or Unavailable

The app scans all current objects under that prefix, including every page and subfolder. Large buckets take longer. Check the key's list permissions and connection, then refresh. Historical versions and deleted objects do not count toward current-folder totals.

## Deletion fails

Check `deleteFiles` permission, bucket access, Object Lock, retention and legal holds. An upload actively writing the same destination must finish or be cancelled first. Retained versions may still consume storage after hiding current files. Never assume a hidden file's storage has been permanently reclaimed.

## Connection is offline

The app keeps the encrypted saved key and checks connectivity again. A revoked/expired key must be replaced. No app can prevent an actual internet outage. A recovered connection does not automatically restart transfers that already exhausted retries.

## Current limits

- No transfer resume after app/process restart; reselect interrupted files.
- No two-way sync, Finder drive mount, cloud rename/move, client-side encryption, deduplication or independent second-backup destination.
- Photos are classified by extensions. Gallery tiles are placeholders; supported previews download originals. HEIC/RAW need an external viewer.
- Search/counts cover loaded library pages until scanning completes. File browsing and folder sizes have separate scopes.
- In-app version restore supports versions up to 5 GB.
- Backup checks use size/time; successful size verification is not end-to-end cryptographic integrity verification.
- Multi-GB live transfers, prolonged outages and sleep during transfers still require broader live testing.

See [testing](testing.md) for verified coverage. Reports use synthetic fixtures; no private account screenshots are included.
