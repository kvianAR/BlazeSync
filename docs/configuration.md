# Use BlazeSync

## Menu bar and background behavior

BlazeSync starts in the macOS menu bar without a Dock icon. Click its minimal cloud icon and choose **Open BlazeSync**. Closing the window keeps the app running. **Quit BlazeSync** stops it and removes the icon.

Scheduled backups need BlazeSync running and your Mac awake. No login item or persistent system service is installed.

## Files and folders

Choose a bucket in the sidebar; the breadcrumb always identifies the current folder. Upload with **Upload files / folders**, or drop files/folders on the main window, mini panel or native menu-bar icon. The mini panel displays the upload destination. Open a bucket first if no destination has been selected.

Folder uploads preserve nested structure and empty folders. Selected folders include hidden files except `.DS_Store`; symlinks are skipped. Pending uploads appear inline and in Transfers.

**Download folder** queues all current files under a folder into a fresh local destination, preserving subfolders. It is not a ZIP export. Review individual file failures in Transfers.

Current folder size includes all current nested files across every listing page. Each immediate child folder shows its own recursive size and file count. Loading and failed checks do not pretend to be a verified zero. Sizes use decimal KB/MB/GB.

## Cloud refresh

Connection settings offers 15/30/60-second or manual refresh. Visible windows also refresh when focused. The timestamp identifies the last successful check. Refresh failures preserve the previous list. This reconciles cloud listings; it is not two-way local-folder synchronization.

## One-way folder backups

Add a backup, select a local folder and choose every 5 minutes, hour or day. Jobs are tied to the original endpoint and Key ID. New/changed files upload automatically; deleting a local file does not delete the cloud copy. Renamed files can leave older objects behind.

Change detection uses size and modification time, not a content hash. Files that change during upload are reported as failures. This is not a complete system snapshot or an independent second backup.

## Transfers and appearance

Transfers shows queue state, direction, progress, estimated speed and remaining time. Estimates can change; stalled transfers show zero speed. Cancelling a transfer does not guarantee that no remote object was created before cancellation.

Use the sun/moon control for light/dark themes. The preference is saved and shared with the mini panel. Saved credentials stay locked until you explicitly choose Change connection.
