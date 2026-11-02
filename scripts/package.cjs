const { execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs/promises");
(async () => {
  const root = path.resolve(__dirname, "..");
  const module = await import("@electron/packager");
  const packager = module.default || module.packager;
  const pkg = require("../package.json");
  const staging = path.join(root, "work", "package-staging");
  await fs.rm(staging, { recursive: true, force: true });
  const result = await packager({
    dir: root,
    name: "BlazeSync",
    platform: "darwin",
    arch: "arm64",
    out: staging,
    overwrite: true,
    icon: path.join(root, "assets", "BlazeSync.icns"),
    appVersion: pkg.version,
    appBundleId: "com.blazesync.desktop",
    extendInfo: path.join(root, "assets", "mac-info.plist"),
    ignore:
      /^\/(?:(?:work|outputs|tests|src|scripts|docs|third-party-notices|\.git|\.github)(?:\/|$)|assets\/(?:BlazeSync\.iconset(?:\/|$)|.*(?:preview|menubar)\.png$|smoke-result\.json$))/,
  });
  execFileSync(
    "/usr/bin/codesign",
    ["--force", "--deep", "--sign", "-", path.join(result[0], "BlazeSync.app")],
    { stdio: "inherit" },
  );
  execFileSync(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", path.join(result[0], "BlazeSync.app")],
    { stdio: "inherit" },
  );
  await fs.writeFile(
    path.join(root, "work", "packaged-path.txt"),
    path.join(result[0], "BlazeSync.app"),
  );
  console.log(
    "Temporary validation build prepared. The installed app has not been replaced.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
