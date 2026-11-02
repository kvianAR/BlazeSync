const { ListObjectsV2Command } = require("@aws-sdk/client-s3");
class FolderMetrics {
  constructor() {
    this.generation = 0;
    this.cache = new Map();
    this.pending = new Map();
  }
  invalidate() {
    this.generation++;
    this.cache.clear();
  }
  async read(client, bucket, prefix = "", force = false) {
    const generation = this.generation,
      key = JSON.stringify([bucket, prefix]);
    const cached = this.cache.get(key);
    if (
      !force &&
      cached?.client === client &&
      cached.generation === generation &&
      Date.now() - cached.value.checkedAt < 30000
    )
      return cached.value;
    const existing = this.pending.get(key);
    if (existing?.client === client && existing.generation === generation)
      return existing.promise;
    const entry = { client, generation };
    entry.promise = (async () => {
      let token,
        totalBytes = 0,
        fileCount = 0,
        pages = 0;
      const children = new Map(),
        seenTokens = new Set();
      do {
        const r = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            MaxKeys: 1000,
            ContinuationToken: token,
          }),
        );
        pages++;
        for (const item of r.Contents || []) {
          if (!item.Key.startsWith(prefix))
            throw new Error(
              "Backblaze returned an object outside this folder.",
            );
          const relative = item.Key.slice(prefix.length);
          if (!relative) continue;
          const slash = relative.indexOf("/");
          let child;
          if (slash >= 0) {
            const key = prefix + relative.slice(0, slash + 1);
            if (!children.has(key)) children.set(key, { bytes: 0, files: 0 });
            child = children.get(key);
          }
          if (item.Key.endsWith("/")) continue;
          if (!Number.isSafeInteger(item.Size) || item.Size < 0)
            throw new Error("Backblaze returned an invalid file size.");
          totalBytes += item.Size;
          fileCount++;
          if (child) {
            child.bytes += item.Size;
            child.files++;
          }
        }
        token = r.NextContinuationToken;
        if (r.IsTruncated && !token)
          throw new Error(
            "Backblaze returned an incomplete folder page without a continuation token.",
          );
        if (token) {
          if (seenTokens.has(token))
            throw new Error("Backblaze repeated a folder page. Retry refresh.");
          seenTokens.add(token);
        }
      } while (token);
      const value = {
        bytes: totalBytes,
        files: fileCount,
        folders: Object.fromEntries(children),
        pages,
        checkedAt: Date.now(),
        complete: true,
      };
      if (this.generation === generation) {
        this.cache.set(key, { client, generation, value });
        if (this.cache.size > 64)
          this.cache.delete(this.cache.keys().next().value);
      }
      return value;
    })().finally(() => {
      if (this.pending.get(key) === entry) this.pending.delete(key);
    });
    this.pending.set(key, entry);
    return entry.promise;
  }
}
module.exports = { FolderMetrics };
