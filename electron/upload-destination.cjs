const { ListObjectsV2Command, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { unchangedFile } = require("./folder-sync.cjs");
const { nativeFileIndex } = require("./native-file-index.cjs");

async function inspectUploadDestinations(client, bucket, entries) {
  if (!entries.length) return;
  let prefix = entries[0].key;
  for (const entry of entries) {
    while (!entry.key.startsWith(prefix))
      prefix = prefix.slice(0, prefix.lastIndexOf("/", prefix.length - 2) + 1);
  }
  let index;
  try {
    index = await nativeFileIndex(client, bucket, prefix);
  } catch {
    // Keep S3-compatible listing available when the native index is unavailable or restricted.
  }
  if (index) {
    for (const entry of entries) {
      entry.remote = index.get(entry.key);
      entry.existing = !!entry.remote;
      entry.unchanged = entry.directory && entry.existing;
    }
    return;
  }
  const wanted = new Map(entries.map((entry) => [entry.key, null]));
  const tokens = new Set();
  let token;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 1000,
        ContinuationToken: token,
      }),
    );
    for (const object of page.Contents || []) {
      if (wanted.has(object.Key)) wanted.set(object.Key, object);
    }
    token = page.NextContinuationToken;
    if (page.IsTruncated && !token)
      throw new Error("Cloud folder listing is incomplete. Refresh and try again.");
    if (token && tokens.has(token))
      throw new Error("Backblaze repeated a folder page.");
    if (token) tokens.add(token);
  } while (token);
  for (const entry of entries) {
    entry.remote = wanted.get(entry.key);
    entry.existing = !!entry.remote;
    entry.unchanged = entry.directory && entry.existing;
  }
}

async function compareUploadContents(client, bucket, entries, progress = () => {}, signal) {
  let next = 0;
  let completed = 0;
  let failure;
  let lastProgress = 0;
  async function worker() {
    while (!failure && next < entries.length) {
      const entry = entries[next++];
      try {
        signal?.throwIfAborted();
        if (
          !entry.directory &&
          entry.existing &&
          entry.remote.Size === entry.size
        ) {
          let head;
          try {
            const indexed = entry.remote;
            head = indexed.Metadata?.["blazesync-sha256"] || /^[a-f0-9]{40}$/i.test(indexed.ContentSHA1 || "")
              ? indexed
              : await client.send(new HeadObjectCommand({ Bucket: bucket, Key: entry.key }), { abortSignal: signal });
          } catch (error) {
            if (
              error.$metadata?.httpStatusCode !== 404 &&
              error.name !== "NotFound"
            )
              throw error;
          }
          entry.unchanged =
            !!head &&
            (await unchangedFile(client, bucket, entry.key, entry.file, head, signal));
        }
        completed++;
        if (completed === entries.length || Date.now() - lastProgress >= 200) {
          lastProgress = Date.now();
          progress({
            label: "Comparing existing file contents",
            stage: "checking",
            completed,
            total: entries.length,
          });
        }
      } catch (error) {
        failure ||= error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, entries.length) }, worker));
  if (failure) throw failure;
}
module.exports = { inspectUploadDestinations, compareUploadContents };
