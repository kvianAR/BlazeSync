const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateDownloadTargets } = require("../electron/files.cjs");

test("large folder checks handle 47,013 nested destinations", () => {
  const files = Array.from({ length: 47013 }, (_, index) => ({ destination: `/downloads/project/sub/file-${index}` }));
  assert.doesNotThrow(() => validateDownloadTargets("/downloads", files));
});

test("file and folder collisions fail before downloads create local files", () => {
  for (const conflict of [
    { destination: "/downloads/a/b" },
    { destination: "/downloads/a", directory: true },
  ]) {
    assert.throws(() => validateDownloadTargets("/downloads", [
      { destination: "/downloads/a" }, conflict,
    ]), /conflicts with a folder/);
  }
});
