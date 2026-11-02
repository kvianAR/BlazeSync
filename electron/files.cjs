const path = require("node:path");
const fs = require("node:fs/promises");
const { joinKey } = require("./helpers.cjs");
async function* uploadEntries(paths, prefix = "") {
  async function* visit(file, key) {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      yield { key: key + "/", directory: true, size: 0 };
      for (const name of await fs.readdir(file)) {
        if (name !== ".DS_Store")
          yield* visit(path.join(file, name), joinKey(key, name));
      }
    } else if (stat.isFile()) yield { file, key, size: stat.size };
  }
  for (const file of paths) {
    if (
      typeof file !== "string" ||
      !path.isAbsolute(file) ||
      file.includes("\0")
    )
      throw new Error("Choose a local file or folder.");
    yield* visit(file, joinKey(prefix, path.basename(file)));
  }
}
function safeDownloadPath(root, relative) {
  const parts = relative.replace(/\/$/, "").split("/");
  if (
    !relative ||
    parts.some(
      (p) =>
        !p || p === "." || p === ".." || p.includes("\\") || p.includes("\0"),
    )
  )
    throw new Error("Unsafe cloud file name: " + relative);
  const destination = path.resolve(root, ...parts);
  if (!destination.startsWith(path.resolve(root) + path.sep))
    throw new Error("Cloud path escapes destination");
  return destination;
}
function updateProgress(t, loaded, now = Date.now()) {
  t.loaded = loaded;
  t.lastProgressAt = now;
  if (!t.sampleAt) {
    t.sampleAt = t.startedAt || now;
    t.sampleBytes = 0;
  }
  const elapsed = now - t.sampleAt;
  if (elapsed >= 200) {
    const rate = (Math.max(0, loaded - t.sampleBytes) * 1000) / elapsed;
    t.speed = t.speed ? 0.3 * t.speed + 0.7 * rate : rate;
    t.sampleAt = now;
    t.sampleBytes = loaded;
  }
  t.eta = t.speed > 0 ? Math.max(0, (t.size - loaded) / t.speed) : null;
}
function deleteError(error) {
  if (error.name === "AccessDenied" || error.$metadata?.httpStatusCode === 403)
    return new Error(
      "Backblaze refused deletion. The key needs deleteFiles permission. Object Lock, retention or a legal hold may also block deletion.",
    );
  return error;
}
function cancelled() {
  const error = new Error("Transfer cancelled");
  error.name = "AbortError";
  return error;
}
module.exports = {
  uploadEntries,
  safeDownloadPath,
  updateProgress,
  deleteError,
  cancelled,
};
