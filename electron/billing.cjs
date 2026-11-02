const {
  ListObjectVersionsCommand,
  ListMultipartUploadsCommand,
  ListPartsCommand,
} = require("@aws-sdk/client-s3");

const STANDARD_PRICING = Object.freeze({
  plan: "B2 Fundamentals · pay as you go",
  currency: "USD",
  freeStorageBytes: 10_000_000_000,
  usdPerTbPer30Days: 6.95,
  freeEgressMultiplier: 3,
  egressUsdPerGb: 0.01,
  source: "https://www.backblaze.com/cloud-storage/pricing",
  verifiedOn: "2026-11-03",
});

function estimateStorage(bytes, accountComplete = true) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error("Storage size must be a non-negative safe integer.");
  }
  const chargedBytes = Math.max(0, bytes - STANDARD_PRICING.freeStorageBytes);
  const monthlyUsd =
    (chargedBytes / 1_000_000_000_000) * STANDARD_PRICING.usdPerTbPer30Days;
  return {
    storedBytes: bytes,
    freeBytesApplied: Math.min(bytes, STANDARD_PRICING.freeStorageBytes),
    remainingFreeBytes: accountComplete
      ? Math.max(0, STANDARD_PRICING.freeStorageBytes - bytes)
      : null,
    chargedBytes,
    monthlyUsd,
    visibleMaximumUsd: accountComplete
      ? monthlyUsd
      : (bytes / 1_000_000_000_000) * STANDARD_PRICING.usdPerTbPer30Days,
    accountComplete,
    periodDays: 30,
  };
}

function nextPage(seen, marker, message) {
  const value = JSON.stringify(marker);
  if (seen.has(value)) throw new Error(message);
  seen.add(value);
}

async function unfinishedStorage(client, bucket) {
  let keyMarker,
    uploadMarker,
    bytes = 0,
    uploads = 0;
  const pages = new Set();
  do {
    const page = await client.send(
      new ListMultipartUploadsCommand({
        Bucket: bucket,
        KeyMarker: keyMarker,
        UploadIdMarker: uploadMarker,
        MaxUploads: 1000,
      }),
    );
    for (const upload of page.Uploads || []) {
      uploads++;
      let partMarker;
      const partPages = new Set();
      do {
        const parts = await client.send(
          new ListPartsCommand({
            Bucket: bucket,
            Key: upload.Key,
            UploadId: upload.UploadId,
            PartNumberMarker: partMarker,
            MaxParts: 1000,
          }),
        );
        for (const part of parts.Parts || []) {
          if (!Number.isSafeInteger(part.Size) || part.Size < 0)
            throw new Error("Invalid unfinished-upload size.");
          bytes += part.Size;
        }
        partMarker = parts.IsTruncated ? parts.NextPartNumberMarker : undefined;
        if (parts.IsTruncated && partMarker == null)
          throw new Error("Incomplete multipart part listing.");
        if (partMarker != null)
          nextPage(partPages, partMarker, "Repeated multipart part page.");
      } while (partMarker != null);
    }
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    uploadMarker = page.IsTruncated ? page.NextUploadIdMarker : undefined;
    if (page.IsTruncated && !keyMarker)
      throw new Error("Incomplete unfinished-upload listing.");
    if (keyMarker)
      nextPage(
        pages,
        [keyMarker, uploadMarker],
        "Repeated unfinished-upload page.",
      );
  } while (keyMarker);
  return { bytes, uploads };
}

async function scanStorage(
  client,
  buckets,
  scope = "unknown",
  onProgress = () => {},
) {
  const rows = [];
  for (const bucket of [...new Set(buckets)]) {
    const row = {
      bucket,
      currentBytes: 0,
      retainedBytes: 0,
      unfinishedBytes: 0,
      currentFiles: 0,
      retainedVersions: 0,
      deleteMarkers: 0,
      unfinishedUploads: 0,
      errors: [],
    };
    let marker;
    const pages = new Set();
    try {
      do {
        const result = await client.send(
          new ListObjectVersionsCommand({
            Bucket: bucket,
            MaxKeys: 1000,
            KeyMarker: marker?.key,
            VersionIdMarker: marker?.version,
          }),
        );
        for (const version of result.Versions || []) {
          if (!Number.isSafeInteger(version.Size) || version.Size < 0)
            throw new Error("Invalid cloud version size.");
          if (version.IsLatest) {
            row.currentBytes += version.Size;
            row.currentFiles++;
          } else {
            row.retainedBytes += version.Size;
            row.retainedVersions++;
          }
        }
        row.deleteMarkers += (result.DeleteMarkers || []).length;
        marker = result.IsTruncated
          ? { key: result.NextKeyMarker, version: result.NextVersionIdMarker }
          : null;
        if (marker && !marker.key)
          throw new Error("Incomplete storage version listing.");
        if (marker) nextPage(pages, marker, "Repeated storage version page.");
      } while (marker);
    } catch (error) {
      row.errors.push("Version listing failed. " + error.message);
    }
    try {
      const unfinished = await unfinishedStorage(client, bucket);
      row.unfinishedBytes = unfinished.bytes;
      row.unfinishedUploads = unfinished.uploads;
    } catch (error) {
      row.errors.push("Unfinished upload listing failed. " + error.message);
    }
    row.totalBytes = row.currentBytes + row.retainedBytes + row.unfinishedBytes;
    rows.push(row);
    onProgress({ completed: rows.length, total: buckets.length, bucket });
  }
  const totalBytes = rows.reduce((sum, row) => sum + row.totalBytes, 0);
  const complete = rows.every((row) => !row.errors.length);
  return {
    rows,
    totalBytes,
    scope,
    complete,
    currentBytes: rows.reduce((sum, row) => sum + row.currentBytes, 0),
    retainedBytes: rows.reduce((sum, row) => sum + row.retainedBytes, 0),
    unfinishedBytes: rows.reduce((sum, row) => sum + row.unfinishedBytes, 0),
    estimate: estimateStorage(totalBytes, scope === "account" && complete),
    pricing: STANDARD_PRICING,
    checkedAt: Date.now(),
  };
}
module.exports = { STANDARD_PRICING, estimateStorage, scanStorage };
