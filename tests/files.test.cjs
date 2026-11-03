const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  uploadEntries,
  safeDownloadPath,
  updateProgress,
  deleteError,
} = require("../electron/files.cjs");
test("folder upload preserves hierarchy, empty directories, hidden files; skips symlinks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "blazesync-tree-"));
  try {
    const folder = path.join(root, "Project");
    await fs.mkdir(path.join(folder, "sub", "empty"), { recursive: true });
    await fs.writeFile(path.join(folder, "sub", "a.txt"), "data");
    await fs.writeFile(path.join(folder, ".env"), "hidden");
    await fs.symlink("/etc/hosts", path.join(folder, "skip"));
    const items = [];
    for await (const entry of uploadEntries([folder], "Destination/"))
      items.push(entry);
    assert.ok(
      items.some(
        (e) => e.key === "Destination/Project/sub/empty/" && e.directory,
      ),
    );
    assert.ok(items.some((e) => e.key === "Destination/Project/sub/a.txt"));
    assert.ok(items.some((e) => e.key === "Destination/Project/.env"));
    assert.equal(
      items.some((e) => e.key.endsWith("skip")),
      false,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("folder download rejects traversal, ambiguous names and separators", () => {
  assert.equal(
    safeDownloadPath("/safe/root", "sub/file.txt"),
    "/safe/root/sub/file.txt",
  );
  for (const relative of [
    "../outside",
    "/abs",
    "a/../../escape",
    "a//b",
    "a\\b",
    "a/./b",
    "bad\0name",
  ])
    assert.throws(() => safeDownloadPath("/safe/root", relative), /Unsafe/);
});
test("transfer speed uses elapsed bytes and provides remaining time", () => {
  const t = { size: 1000, startedAt: 1000 };
  updateProgress(t, 500, 2000);
  assert.equal(t.speed, 500);
  assert.equal(t.eta, 1);
  updateProgress(t, 750, 2500);
  assert.equal(t.speed, 500);
  assert.equal(t.eta, 0.5);
});
test("deletion permission errors explain capabilities and retention", () => {
  const error = deleteError({ name: "AccessDenied" });
  assert.match(error.message, /deleteFiles/);
  assert.match(error.message, /retention/);
  const network = new Error("offline");
  assert.equal(deleteError(network), network);
});

test("delete preserves a diagnosed account cap instead of suggesting a permission change", () => {
  const error = new Error("Backblaze account cap reached");
  error.name = "BackblazeCapExceeded";
  error.$metadata = { httpStatusCode: 403 };
  assert.equal(deleteError(error), error);
});
