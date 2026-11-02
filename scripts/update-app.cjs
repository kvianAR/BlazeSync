const path = require("node:path");
const fs = require("node:fs/promises");
const { execFileSync } = require("node:child_process");
const { isBlazeSyncRunning } = require("./app-process.cjs");
(async () => {
  const root = path.resolve(__dirname, ".."),
    target = path.join(root, "outputs", "BlazeSync.app"),
    source = (
      await fs.readFile(path.join(root, "work", "packaged-path.txt"), "utf8")
    ).trim();
  if (!source.startsWith(path.join(root, "work", "package-staging") + path.sep))
    throw new Error("Unexpected staging path");
  await fs.access(path.join(source, "Contents", "MacOS", "BlazeSync"));
  const commands = execFileSync("/bin/ps", ["-axo", "comm="], {
    encoding: "utf8",
  });
  if (isBlazeSyncRunning(commands))
    throw new Error(
      "BlazeSync is still running. Quit it normally before updating.",
    );
  await fs.mkdir(target, { recursive: true });
  execFileSync(
    "/usr/bin/rsync",
    ["-a", "--delete", source + "/", target + "/"],
    { stdio: "inherit" },
  );
  execFileSync(
    "/usr/bin/codesign",
    ["--force", "--deep", "--sign", "-", target],
    { stdio: "inherit" },
  );
  execFileSync(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", target],
    { stdio: "inherit" },
  );
  await fs.rm(path.join(root, "work", "package-staging"), {
    recursive: true,
    force: true,
  });
  for (const entry of await fs.readdir(path.join(root, "work"))) {
    if (/^BlazeSync-(?:before-|0\.1\.0-backup).*\.app$/.test(entry))
      await fs.rm(path.join(root, "work", entry), {
        recursive: true,
        force: true,
      });
  }
  console.log(
    "Updated the existing outputs/BlazeSync.app. No duplicate app or versioned backup was kept.",
  );
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
