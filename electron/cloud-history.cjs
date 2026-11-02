const {
  ListObjectVersionsCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
async function historyPage(client, bucket, prefix = "", marker) {
  const r = await client.send(
    new ListObjectVersionsCommand({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 1000,
      KeyMarker: marker?.key,
      VersionIdMarker: marker?.version,
    }),
  );
  if (r.IsTruncated && !r.NextKeyMarker)
    throw new Error(
      "Backblaze returned incomplete version history without a next marker.",
    );
  return {
    entries: [
      ...(r.Versions || []).map((v) => ({
        key: v.Key,
        id: v.VersionId,
        size: v.Size,
        modified: v.LastModified?.toISOString(),
        latest: v.IsLatest,
        deleted: false,
      })),
      ...(r.DeleteMarkers || []).map((v) => ({
        key: v.Key,
        id: v.VersionId,
        size: 0,
        modified: v.LastModified?.toISOString(),
        latest: v.IsLatest,
        deleted: true,
      })),
    ].sort(
      (a, b) =>
        a.key.localeCompare(b.key) ||
        new Date(b.modified) - new Date(a.modified),
    ),
    next: r.IsTruncated
      ? { key: r.NextKeyMarker, version: r.NextVersionIdMarker }
      : null,
  };
}
async function exactVersions(client, bucket, key) {
  let marker;
  const entries = [],
    markers = new Set();
  do {
    const page = await historyPage(client, bucket, key, marker);
    entries.push(...page.entries.filter((v) => v.key === key));
    marker = page.next;
    if (marker) {
      const id = JSON.stringify(marker);
      if (markers.has(id))
        throw new Error("Backblaze repeated a version history page.");
      markers.add(id);
    }
  } while (marker);
  return entries;
}
async function purgeVersions(client, bucket, key, entries) {
  let count = 0;
  for (const entry of entries) {
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
        VersionId: entry.id,
      }),
    );
    count++;
  }
  const remaining = await exactVersions(client, bucket, key);
  if (remaining.length)
    throw new Error(
      "Some versions remain in Backblaze. Another upload or retention rule may be preventing complete removal.",
    );
  return count;
}
module.exports = { historyPage, exactVersions, purgeVersions };
