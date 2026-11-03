const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { joinKey } = require("./helpers.cjs");
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const verifiedVersions = new WeakMap();

async function hashFile(file, signal) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file, { signal }))
    hash.update(chunk);
  return hash.digest("hex");
}
async function unchangedFile(client, bucket, key, file, head) {
  const stat = await fs.promises.stat(file);
  if (!head || head.ContentLength !== stat.size) return false;
  const localHash = await hashFile(file);
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
  );
  const hash = crypto.createHash("sha256");
  for await (const chunk of remote.Body) hash.update(chunk);
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
