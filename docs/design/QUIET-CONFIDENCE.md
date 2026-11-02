# BlazeSync — Quiet Confidence design handoff

## Direction

An actual file manager, with compact cloud status rather than decorative dashboard cards. Slate surfaces, electric-blue actions and restrained amber for folders/history. Native system typography stays crisp and needs no external font request. Existing BlazeSync logo stays intact.

UI/UX Pro Max's verified File Manager & Transfer product match recommends flat/minimal file-tree-focused design and functional neutral colors. The first broad design-system query suggested a marketing demo pattern; that layout was rejected as unsuitable for an operational desktop file browser. The user's supplied design brief owns the visual direction.

## Tokens

`src/quiet.css` defines canvas, surface, raised/muted surfaces, foreground, muted/faint text, border, primary/soft accent, amber, success and destructive tokens for light and dark themes. Common spacing uses 6/8/12/16/20/24/30px. Panels use a 14px radius; controls use 8px. Native system font; 29px page title, 13px primary rows/body, 11–12px metadata. Keyboard focus uses a 3px blue ring; reduced-motion preferences disable animations. Icons use Lucide with labels/tooltips on standalone actions.

## Information architecture

- My files: bucket/folder browser, breadcrumbs, current files and cloud history tabs.
- Files and Photos: type-based libraries; neither claims complete totals before pagination finishes.
- Transfers: direction, destination, status, speed and remaining time.
- Folder backups: configured one-way backups; not bidirectional synchronization.
- Connection/settings: locked credentials, theme toggle and cloud refresh interval.
- Menu-bar panel: destination, drop uploads, recent transfers and full-app shortcuts.

## Accurate cloud semantics

Live read-only investigation of the selected bucket returned no current files, one older video version and its latest delete marker. This explains the original screenshot discrepancy. No user cloud object was modified during investigation.

The UI now exposes **Current files** and **Versions & deleted**, so a hidden object is not mistaken for an untracked synchronization failure. Deleting current objects hides them. **Permanently delete all versions** enumerates exact-key versions and delete markers, requests deliberate confirmation, sends version-specific cloud deletions and verifies that history is empty. Retention/legal holds and permissions are never bypassed.

Visible windows poll every 15 seconds by default, with 30/60-second and manual options. Focus also refreshes. A timestamp shows the last successful listing check. Refresh errors retain the last successful list instead of presenting an unverified empty result. History is separately permission-gated and reports access errors. Sizes use decimal KB/MB/GB to match the B2 console convention.

## Responsive/platform boundaries

Implemented desktop layouts were rendered at 768, 1280 and 1600 CSS-pixel widths, with light/dark screenshots. The macOS desktop app remains the actual shipped artifact. Its minimum width is 760px.

Android at approximately 390px is a **proposed future native client**, not a functioning release: bottom navigation (Files, Transfers, Backups, Settings), native document picker and bottom-sheet item actions. Tablet at 768px would use a two-pane browser. Android background transfers would require native foreground-service/WorkManager behavior; the macOS tray mechanism cannot be reused as that implementation. Windows packaging and a native Android client have not been built or validated here. Multi-selection, grid browsing and retry controls beyond existing behavior remain future scope.

## Reusable implementation

Semantic tokens in `quiet.css`; existing app shell, Stat, Empty and PageTitle; new cloud-status strip, view tabs, history rows and deletion states. Cloud history enumeration/purge is isolated in `electron/cloud-history.cjs`. Existing drag/drop, protected credentials and file transfers remain functional and covered by regressions.
