const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeSelection,
  validName,
  folderPrefix,
  createMovePlan,
  executeMove,
} = require("../electron/file-management.cjs");

function fixture(initial, intercept = () => {}) {
  const values = new Map(
    Object.entries(initial).map(([key, size], index) => [
      key,
      {
        ContentLength: size,
        ETag: "etag-" + index,
        VersionId: "version-" + index,
        Metadata: { original: "yes" },
      },
    ]),
  );
  const calls = [],
    uploads = new Map();
  let version = 100;
  const client = {
    send: async (command) => {
      const type = command.constructor.name,
        input = command.input;
      calls.push({ type, input });
      await intercept(type, input, values);
      const key = input.Bucket + "/" + input.Key;
      if (type === "HeadObjectCommand") {
        if (!values.has(key)) {
          const error = new Error("Not found");
          error.$metadata = { httpStatusCode: 404 };
          throw error;
        }
        return { ...values.get(key) };
      }
      if (type === "ListObjectsV2Command")
        return {
          Contents: [...values]
            .filter(([name]) =>
              name.startsWith(input.Bucket + "/" + input.Prefix),
            )
            .map(([name, head]) => ({
              Key: name.slice(input.Bucket.length + 1),
              Size: head.ContentLength,
            })),
        };
      if (type === "CopyObjectCommand") {
        const source = input.CopySource.split("?")[0]
          .split("/")
          .map(decodeURIComponent)
          .join("/");
        values.set(key, {
          ...values.get(source),
          VersionId: "copy-" + version++,
        });
        return {};
      }
      if (type === "DeleteObjectCommand") {
        values.delete(key);
        return {};
      }
      if (type === "CreateMultipartUploadCommand") {
        uploads.set("upload-id", { key, input, size: 0 });
        return { UploadId: "upload-id" };
      }
      if (type === "UploadPartCopyCommand") {
        const range = input.CopySourceRange.match(/bytes=(\d+)-(\d+)/);
        uploads.get(input.UploadId).size +=
          Number(range[2]) - Number(range[1]) + 1;
        return { CopyPartResult: { ETag: "part-" + input.PartNumber } };
      }
      if (type === "CompleteMultipartUploadCommand") {
        const upload = uploads.get(input.UploadId);
        values.set(upload.key, {
          ContentLength: upload.size,
          Metadata: upload.input.Metadata,
          ETag: "multipart",
          VersionId: "copied-multipart",
        });
        uploads.delete(input.UploadId);
        return {};
      }
      if (type === "AbortMultipartUploadCommand") {
        uploads.delete(input.UploadId);
        return {};
      }
      throw new Error("Unhandled " + type);
    },
  };
  return { client, values, calls, uploads };
}

test("selection removes duplicate objects and children already covered by selected folders", () => {
  assert.deepEqual(
    normalizeSelection([
      { key: "A/a", folder: false },
      { key: "A/", folder: true },
      { key: "A/sub/", folder: true },
      { key: "A/", folder: true },
    ]),
    [{ key: "A/", folder: true }],
  );
  assert.throws(() => normalizeSelection([{ key: "", folder: true }]));
});
test("rename/path validation rejects dot traversal and controls while preserving valid names", () => {
  assert.equal(validName(" New name "), "New name");
  for (const value of [" . ", "..", "a/b", "a\\b", "bad\0"])
    assert.throws(() => validName(value));
  assert.equal(folderPrefix("Projects/2026/"), "Projects/2026/");
  for (const value of ["a/../b", "a//b", "a\\b"])
    assert.throws(() => folderPrefix(value));
});
test("file rename uses a version-bound copy, verifies size and removes source current object", async () => {
  const f = fixture({ "bucket/old.txt": 15 });
  const plan = await createMovePlan(
    f.client,
    "bucket",
    [{ key: "old.txt" }],
    "bucket",
    "",
    "new.txt",
  );
  await executeMove(f.client, plan, false);
  assert.equal(f.values.has("bucket/old.txt"), false);
  assert.equal(f.values.get("bucket/new.txt").ContentLength, 15);
  assert.match(
    f.calls.find((call) => call.type === "CopyObjectCommand").input.CopySource,
    /versionId=/,
  );
});
test("nested folders move across buckets with hierarchy and empty markers", async () => {
  const f = fixture({
    "source/Project/": 0,
    "source/Project/empty/": 0,
    "source/Project/sub/a.txt": 20,
  });
  const plan = await createMovePlan(
    f.client,
    "source",
    [{ key: "Project/", folder: true }],
    "target",
    "Archive/",
  );
  const result = await executeMove(f.client, plan, false);
  assert.equal(result.removed, 3);
  assert.equal(
    f.values.get("target/Archive/Project/sub/a.txt").ContentLength,
    20,
  );
  assert.ok(f.values.has("target/Archive/Project/empty/"));
});
test("folder cannot move inside itself and no-op rename is rejected", async () => {
  const f = fixture({ "b/Project/a": 1 });
  await assert.rejects(
    createMovePlan(
      f.client,
      "b",
      [{ key: "Project/", folder: true }],
      "b",
      "Project/sub",
    ),
    /outside/,
  );
  await assert.rejects(
    createMovePlan(f.client, "b", [{ key: "Project/a" }], "b", "Project/"),
    /different/,
  );
});
test("overwrite requires approval and an altered target causes preflight failure", async () => {
  const f = fixture({ "b/a": 1, "b/target/a": 2 });
  const plan = await createMovePlan(
    f.client,
    "b",
    [{ key: "a" }],
    "b",
    "target/",
  );
  await assert.rejects(executeMove(f.client, plan, false), /Confirm overwrite/);
  f.values.set("b/target/a", { ContentLength: 5, VersionId: "external" });
  await assert.rejects(
    executeMove(f.client, plan, true),
    /Destination changed/,
  );
  assert.equal(f.values.get("b/a").ContentLength, 1);
});
test("a failed copy leaves all source current objects intact", async () => {
  const f = fixture({ "b/Project/a": 1, "b/Project/b": 2 }, (type, input) => {
    if (type === "CopyObjectCommand" && input.Key.endsWith("/b"))
      throw new Error("copy failed");
  });
  const plan = await createMovePlan(
    f.client,
    "b",
    [{ key: "Project/", folder: true }],
    "b",
    "Target/",
  );
  await assert.rejects(executeMove(f.client, plan, false), /copy failed/);
  assert.ok(f.values.has("b/Project/a") && f.values.has("b/Project/b"));
  assert.equal(
    f.calls.some((call) => call.type === "DeleteObjectCommand"),
    false,
  );
});
test("a concurrently changed source is kept after copies finish", async () => {
  const f = fixture({ "b/a": 3 }, (type, input, values) => {
    if (type === "CopyObjectCommand")
      values.set("b/a", { ContentLength: 4, VersionId: "new-external" });
  });
  const plan = await createMovePlan(
    f.client,
    "b",
    [{ key: "a" }],
    "b",
    "Target/",
  );
  await assert.rejects(
    executeMove(f.client, plan, false),
    /Source changed|Destination size/,
  );
  assert.equal(f.values.get("b/a").VersionId, "new-external");
});
test("delete rejection preserves verified destination and reports partial state", async () => {
  const f = fixture({ "b/a": 3 }, (type) => {
    if (type === "DeleteObjectCommand") throw new Error("retention");
  });
  const plan = await createMovePlan(
    f.client,
    "b",
    [{ key: "a" }],
    "b",
    "Target/",
  );
  await assert.rejects(
    executeMove(f.client, plan, false),
    /1 copied, 0 source objects removed/,
  );
  assert.ok(f.values.has("b/a") && f.values.has("b/Target/a"));
});
test("large files use multipart server-side copy and preserve metadata", async () => {
  const length = 5 * 1024 ** 3 + 123;
  const f = fixture({ "b/large": length });
  const plan = await createMovePlan(
    f.client,
    "b",
    [{ key: "large" }],
    "b",
    "Target/",
  );
  await executeMove(f.client, plan, false);
  assert.equal(f.values.get("b/Target/large").ContentLength, length);
  assert.equal(f.values.get("b/Target/large").Metadata.original, "yes");
  assert.ok(
    f.calls.filter((call) => call.type === "UploadPartCopyCommand").length > 1,
  );
});
test("failed multipart copy aborts unfinished destination upload and keeps source", async () => {
  const f = fixture({ "b/large": 6 * 1024 ** 3 }, (type) => {
    if (type === "UploadPartCopyCommand")
      throw new Error("network copy failure");
  });
  const plan = await createMovePlan(
    f.client,
    "b",
    [{ key: "large" }],
    "b",
    "Target/",
  );
  await assert.rejects(
    executeMove(f.client, plan, false),
    /network copy failure/,
  );
  assert.equal(f.uploads.size, 0);
  assert.ok(f.values.has("b/large"));
});

test("move rejects destinations overlapping a selected source", async () => {
  const { client } = fixture({ "bucket/a.txt": 1, "bucket/target/a.txt": 2 });
  await assert.rejects(
    createMovePlan(
      client,
      "bucket",
      [{ key: "a.txt" }, { key: "target/", folder: true }],
      "bucket",
      "target/",
    ),
    /overlap|outside/,
  );
});
