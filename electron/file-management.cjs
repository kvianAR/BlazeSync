const {
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCopyCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} = require("@aws-sdk/client-s3");

function normalizeSelection(entries) {
  if (!Array.isArray(entries) || !entries.length)
    throw new Error("Select at least one file or folder.");
  const unique = new Map();
  for (const entry of entries) {
    if (
      typeof entry.key !== "string" ||
      !entry.key ||
      (entry.folder && !entry.key.endsWith("/"))
    ) {
      throw new Error("Select valid non-root files or folders.");
    }
    unique.set((entry.folder ? "d:" : "f:") + entry.key, {
      key: entry.key,
      folder: !!entry.folder,
    });
  }
  const selected = [...unique.values()];
  return selected.filter(
    (entry) =>
      !selected.some(
        (parent) =>
          parent !== entry && parent.folder && entry.key.startsWith(parent.key),
      ),
  );
}

function validName(name) {
  if (typeof name !== "string") throw new Error("Enter a name.");
  const value = name.trim();
  if (!value || value === "." || value === ".." || /[\\/\x00-\x1f]/.test(value))
    throw new Error("Use a name without slashes or control characters.");
  return value;
}
function folderPrefix(value) {
  if (typeof value !== "string" || /[\\\x00-\x1f]/.test(value))
    throw new Error("Enter a valid destination folder.");
  const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "";
  if (trimmed.split("/").some((part) => !part || part === "." || part === ".."))
    throw new Error("Use a folder path without empty or dot segments.");
  return trimmed + "/";
}
function baseName(entry) {
  return entry.key.replace(/\/$/, "").split("/").pop();
}
function encodedSource(bucket, key, version) {
  const source =
    encodeURIComponent(bucket) +
    "/" +
    key.split("/").map(encodeURIComponent).join("/");
  return version
    ? source + "?versionId=" + encodeURIComponent(version)
    : source;
}
async function headOrNull(client, bucket, key) {
  try {
    return await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404 || error.name === "NotFound")
      return null;
    throw error;
  }
}
async function selectedObjects(client, bucket, entries) {
  const result = new Map();
  for (const entry of normalizeSelection(entries)) {
    if (!entry.folder) {
      const head = await headOrNull(client, bucket, entry.key);
      if (!head)
        throw new Error("The source file no longer exists: " + entry.key);
      result.set(entry.key, { key: entry.key, size: head.ContentLength, head });
      continue;
    }
    let token;
    const seen = new Set();
    let found = false;
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: entry.key,
          MaxKeys: 1000,
          ContinuationToken: token,
        }),
      );
      for (const file of page.Contents || []) {
        found = true;
        result.set(file.Key, { key: file.Key, size: file.Size });
      }
      token = page.NextContinuationToken;
      if (page.IsTruncated && !token)
        throw new Error("Incomplete source folder listing.");
      if (token) {
        if (seen.has(token)) throw new Error("Repeated source folder page.");
        seen.add(token);
      }
    } while (token);
    if (!found)
      throw new Error("The source folder no longer exists: " + entry.key);
  }
  return [...result.values()];
}
async function createMovePlan(
  client,
  bucket,
  entries,
  destinationBucket,
  destination,
  newName,
) {
  const selection = normalizeSelection(entries);
  if (!destinationBucket) throw new Error("Choose a destination bucket.");
  if (newName != null && selection.length !== 1)
    throw new Error("Rename one item at a time.");
  const prefix = folderPrefix(destination);
  const names = selection.map((entry) => {
    const name = newName == null ? baseName(entry) : validName(newName);
    const target = prefix + name + (entry.folder ? "/" : "");
    if (
      bucket === destinationBucket &&
      (target === entry.key || (entry.folder && target.startsWith(entry.key)))
    ) {
      throw new Error(
        "Choose a different destination outside the source folder.",
      );
    }
    return { ...entry, target };
  });
  const objects = await selectedObjects(client, bucket, selection);
  const targetKeys = new Set();
  const plan = [];
  for (const object of objects) {
    const owner = names.find((entry) =>
      entry.folder
        ? object.key.startsWith(entry.key)
        : object.key === entry.key,
    );
    if (!owner)
      throw new Error("Cloud returned an object outside the selected folder.");
    const target =
      owner.target + (owner.folder ? object.key.slice(owner.key.length) : "");
    if (
      bucket === destinationBucket &&
      selection.some((entry) =>
        entry.folder ? target.startsWith(entry.key) : target === entry.key,
      )
    )
      throw new Error(
        "Destination overlaps another selected source. Move these items separately.",
      );
    if (targetKeys.has(target))
      throw new Error("Selected items would write to the same destination.");
    targetKeys.add(target);
    const sourceHead =
      object.head || (await headOrNull(client, bucket, object.key));
    if (!sourceHead)
      throw new Error("Source changed while preparing move: " + object.key);
    const destinationHead = await headOrNull(client, destinationBucket, target);
    plan.push({ source: object.key, target, sourceHead, destinationHead });
  }
  return {
    bucket,
    destinationBucket,
    selection: names,
    objects: plan,
    conflicts: plan
      .filter((item) => item.destinationHead)
      .map((item) => item.target),
  };
}
async function copyFile(
  client,
  bucket,
  key,
  destinationBucket,
  target,
  sourceHead,
) {
  const copySource = encodedSource(bucket, key, sourceHead.VersionId);
  if (sourceHead.ContentLength <= 5 * 1024 ** 3) {
    await client.send(
      new CopyObjectCommand({
        Bucket: destinationBucket,
        Key: target,
        CopySource: copySource,
        CopySourceIfMatch: sourceHead.ETag,
      }),
    );
  } else {
    const started = await client.send(
      new CreateMultipartUploadCommand({
        Bucket: destinationBucket,
        Key: target,
        Metadata: sourceHead.Metadata,
        ContentType: sourceHead.ContentType,
        ContentDisposition: sourceHead.ContentDisposition,
        CacheControl: sourceHead.CacheControl,
        ContentEncoding: sourceHead.ContentEncoding,
        ContentLanguage: sourceHead.ContentLanguage,
        Expires: sourceHead.Expires,
      }),
    );
    if (!started.UploadId)
      throw new Error("Multipart copy did not return an upload ID.");
    const partSize = Math.max(
      64 * 1024 ** 2,
      Math.ceil(sourceHead.ContentLength / 10000),
    );
    const parts = [];
    try {
      for (let start = 0; start < sourceHead.ContentLength; start += partSize) {
        const number = parts.length + 1;
        const copied = await client.send(
          new UploadPartCopyCommand({
            Bucket: destinationBucket,
            Key: target,
            UploadId: started.UploadId,
            PartNumber: number,
            CopySource: copySource,
            CopySourceIfMatch: sourceHead.ETag,
            CopySourceRange: `bytes=${start}-${Math.min(sourceHead.ContentLength - 1, start + partSize - 1)}`,
          }),
        );
        if (!copied.CopyPartResult?.ETag)
          throw new Error("A copied part was not verified.");
        parts.push({ PartNumber: number, ETag: copied.CopyPartResult.ETag });
      }
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: destinationBucket,
          Key: target,
          UploadId: started.UploadId,
          MultipartUpload: { Parts: parts },
        }),
      );
    } catch (error) {
      await client
        .send(
          new AbortMultipartUploadCommand({
            Bucket: destinationBucket,
            Key: target,
            UploadId: started.UploadId,
          }),
        )
        .catch(() => {});
      throw error;
    }
  }
  const destination = await headOrNull(client, destinationBucket, target);
  if (!destination || destination.ContentLength !== sourceHead.ContentLength)
    throw new Error(
      "Destination size verification failed. Source has been kept.",
    );
}
function sameVersion(a, b) {
  if (!a || !b) return false;
  if (a.VersionId || b.VersionId) return a.VersionId === b.VersionId;
  return (
    a.ETag === b.ETag &&
    a.ContentLength === b.ContentLength &&
    String(a.LastModified) === String(b.LastModified)
  );
}
async function executeMove(client, plan, overwrite, onProgress = () => {}) {
  if (plan.conflicts.length && !overwrite)
    throw new Error(
      "Destination files already exist. Confirm overwrite first.",
    );
  let copied = 0,
    removed = 0;
  try {
    // Recheck every target before writing, including newly-created conflicts after the dialog opened.
    for (const item of plan.objects) {
      const current = await headOrNull(
        client,
        plan.destinationBucket,
        item.target,
      );
      if (
        !sameVersion(current, item.destinationHead) &&
        (current || item.destinationHead)
      ) {
        throw new Error(
          "Destination changed after confirmation. Review the move again: " +
            item.target,
        );
      }
    }
    // Verify all copies before removing any source current object.
    for (const item of plan.objects) {
      await copyFile(
        client,
        plan.bucket,
        item.source,
        plan.destinationBucket,
        item.target,
        item.sourceHead,
      );
      copied++;
      onProgress({
        stage: "copying",
        completed: copied,
        total: plan.objects.length,
      });
    }
    for (const item of plan.objects) {
      const current = await headOrNull(client, plan.bucket, item.source);
      if (!sameVersion(current, item.sourceHead))
        throw new Error(
          "Source changed during move. Its current object has been kept: " +
            item.source,
        );
    }
    for (const item of plan.objects) {
      const current = await headOrNull(client, plan.bucket, item.source);
      if (!sameVersion(current, item.sourceHead))
        throw new Error(
          "Source changed before deletion and has been kept: " + item.source,
        );
      await client.send(
        new DeleteObjectCommand({ Bucket: plan.bucket, Key: item.source }),
      );
      const remaining = await headOrNull(client, plan.bucket, item.source);
      if (remaining)
        throw new Error(
          "Backblaze did not confirm removal of the source: " + item.source,
        );
      removed++;
      onProgress({
        stage: "moving",
        completed: removed,
        total: plan.objects.length,
      });
    }
    return { copied, removed };
  } catch (error) {
    throw new Error(
      `${error.message} (${copied} copied, ${removed} source objects removed. Verified destination copies are kept.)`,
    );
  }
}
module.exports = {
  normalizeSelection,
  validName,
  folderPrefix,
  baseName,
  selectedObjects,
  createMovePlan,
  executeMove,
  sameVersion,
};
