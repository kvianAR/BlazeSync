const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isBlazeSyncRunning } = require("../scripts/app-process.cjs");
test("same-app updater refuses to overwrite running absolute and relative app launches", () => {
  for (const command of [
    "/Users/example/Projects/BlazeSync/outputs/BlazeSync.app/Contents/MacOS/BlazeSync",
    "outputs/BlazeSync.app/Contents/MacOS/BlazeSync",
    "work/package-staging/BlazeSync-darwin-arm64/BlazeSync.app/Contents/MacOS/BlazeSync",
  ])
    assert.equal(
      isBlazeSyncRunning("/sbin/launchd\n" + command + "\n/bin/zsh"),
      true,
    );
});
test("same-app updater ignores unrelated processes and helper names", () => {
  assert.equal(
    isBlazeSyncRunning(
      "/bin/zsh\n/path/BlazeSync Helper.app/Contents/MacOS/BlazeSync Helper\n/usr/bin/ps",
    ),
    false,
  );
});
