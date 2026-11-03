const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { joinKey } = require("./helpers.cjs");
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const verifiedVersions = new WeakMap();

async function hashFile(file, signal, algorithm = "sha256", progress = () => {}) {
  const hash = crypto.createHash(algorithm);
  let loaded = 0;
  for await (const chunk of fs.createReadStream(file, { signal })) {
    hash.update(chunk);
    loaded += chunk.length;
    progress(loaded);
  }
  return hash.digest("hex");
}
async function unchangedFile(client, bucket, key, file, head, signal) {
  signal?.throwIfAborted();
  const stat = await fs.promises.stat(file);
  if (!head || head.ContentLength !== stat.size) return false;
  if (!head.Metadata?.["blazesync-sha256"] && /^[a-f0-9]{40}$/i.test(head.ContentSHA1 || ""))
    return (await hashFile(file, signal, "sha1")) === head.ContentSHA1.toLowerCase();
  const localHash = await hashFile(file, signal);
  if (head.Metadata?.["blazesync-sha256"])
    return localHash === head.Metadata["blazesync-sha256"];
  let cache = verifiedVersions.get(client);
  if (!cache) {
    cache = new Map();
    verifiedVersions.set(client, cache);
  }
  const versionKey = head.VersionId
    ? JSON.stringify([bucket, key, head.VersionId])
    : null;
  if (versionKey && cache.has(versionKey))
    return localHash === cache.get(versionKey);
  // Older uploads have no content hash. Cache verified bytes for this immutable version.

  const remote = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      VersionId: head.VersionId,
      IfMatch: head.ETag,
    }),
    { abortSignal: signal },
  );
  const hash = crypto.createHash("sha256");
  const abort = () => remote.Body.destroy(signal.reason);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    for await (const chunk of remote.Body) hash.update(chunk);
  } finally {
    signal?.removeEventListener("abort", abort);
    if (signal?.aborted) remote.Body.destroy();
  }
  const remoteHash = hash.digest("hex");
  if (versionKey) {
    if (cache.size >= 2000) cache.delete(cache.keys().next().value);
    cache.set(versionKey, remoteHash);
  }
  return localHash === remoteHash;
}
function folderDestination(prefix, folder) {
  const name = path.basename(folder);
  const current = prefix.replace(/\/+$/, "");
  return current.split("/").pop() === name
    ? current + "/"
    : joinKey(prefix, name) + "/";
}
function syncArguments(args) {
  const marker = args.indexOf("--sync-path");
  return marker < 0 ? [] : args.slice(marker + 1);
}
module.exports = { hashFile, unchangedFile, syncArguments, folderDestination };
