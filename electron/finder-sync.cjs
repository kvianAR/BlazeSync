const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);
function servicePath(home) {
  return path.join(home, "Library", "Services", "Sync with BlazeSync.workflow");
}
function workflowXml(executable) {
  const quoted = "'" + executable.replaceAll("'", "'\\''") + "'";
  const command = quoted + ' --sync-path "$@" >/dev/null 2>&1 &';
  const xml = (value) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>AMApplicationBuild</key><string>523</string>
<key>AMApplicationVersion</key><string>2.10</string>
<key>AMDocumentVersion</key><string>2</string>
<key>actions</key><array><dict><key>action</key><dict>
<key>AMAccepts</key><dict><key>Container</key><string>List</string><key>Optional</key><true/><key>Types</key><array><string>com.apple.cocoa.path</string></array></dict>
<key>AMActionVersion</key><string>2.0.3</string>
<key>AMProvides</key><dict><key>Container</key><string>List</string><key>Types</key><array><string>com.apple.cocoa.string</string></array></dict>
<key>ActionBundlePath</key><string>/System/Library/Automator/Run Shell Script.action</string>
<key>ActionName</key><string>Run Shell Script</string>
<key>ActionParameters</key><dict><key>COMMAND_STRING</key><string>${xml(command)}</string><key>inputMethod</key><integer>1</integer><key>shell</key><string>/bin/zsh</string><key>source</key><string></string></dict>
<key>BundleIdentifier</key><string>com.apple.RunShellScript</string>
<key>CFBundleIdentifier</key><string>com.apple.Automator.CocoaPlugin</string>
<key>UUID</key><string>D097174A-1A1C-4F2D-AF9C-FA783151E294</string>
</dict></dict></array>
<key>workflowMetaData</key><dict>
<key>serviceInputTypeIdentifier</key><string>com.apple.Automator.fileSystemObject</string>
<key>serviceOutputTypeIdentifier</key><string>com.apple.Automator.nothing</string>
<key>serviceProcessesInput</key><integer>0</integer>
<key>serviceApplicationBundleID</key><string>com.apple.finder</string>
<key>serviceApplicationPath</key><string>/System/Library/CoreServices/Finder.app</string>
<key>workflowTypeIdentifier</key><string>com.apple.Automator.servicesMenu</string>
</dict></dict></plist>`;
}
async function installFinderSync(home, executable) {
  const destination = path.join(
    servicePath(home),
    "Contents",
    "document.wflow",
  );
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = destination + ".tmp";
  await fs.writeFile(temporary, workflowXml(executable), { mode: 0o600 });
  await execute("/usr/bin/plutil", ["-lint", temporary]);
  await fs.rename(temporary, destination);
  const info = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>NSServices</key><array><dict><key>NSMenuItem</key><dict><key>default</key><string>Sync with BlazeSync</string></dict><key>NSMessage</key><string>runWorkflowAsService</string><key>NSRequiredContext</key><dict><key>NSApplicationIdentifier</key><string>com.apple.finder</string></dict><key>NSSendFileTypes</key><array><string>public.folder</string></array></dict></array></dict></plist>`;
  await fs.writeFile(path.join(path.dirname(destination), "Info.plist"), info, {
    mode: 0o600,
  });
  await execute("/System/Library/CoreServices/pbs", ["-update"]);
  return servicePath(home);
}
module.exports = { servicePath, workflowXml, installFinderSync };
