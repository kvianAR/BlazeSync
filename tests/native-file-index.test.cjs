const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { nativeFileIndex, registerNativeIndex } = require("../electron/native-file-index.cjs");
const { inspectUploadDestinations, compareUploadContents } = require("../electron/upload-destination.cjs");
const endpoint = "https://s3.us-west-004.backblazeb2.com";
const connection = { endpoint, keyId: "test-id", applicationKey: "test-secret", buckets: ["bucket"] };
const authorization = {
  authorizationToken: "test-token", accountId: "test-account",
  apiInfo: { storageApi: { s3ApiUrl: endpoint, apiUrl: "https://api004.backblazeb2.com", allowed: { buckets: [{ id: "bucket-id", name: "bucket" }] } } },
};
const response = (body) => ({ ok: true, json: async () => body });

test("native index fetches full checksums in paginated listings without per-file HEAD", async () => {
  const client = {};
  const calls = [];
  registerNativeIndex(client, connection, async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("b2_authorize_account")) return response(authorization);
    const body = JSON.parse(options.body);
    assert.equal(body.bucketId, "bucket-id");
    return response({ files: [{ fileName: body.startFileName || "folder/a", fileId: "version", contentLength: 3, contentSha1: "a".repeat(40), fileInfo: { "blazesync-sha256": "hash" } }], nextFileName: body.startFileName ? null : "folder/b" });
  });
  const index = await nativeFileIndex(client, "bucket", "folder/");
  assert.equal(calls.length, 3);
  assert.equal(index.size, 2);
  assert.equal(index.get("folder/a").Metadata["blazesync-sha256"], "hash");
  assert.equal(index.get("folder/b").ContentSHA1, "a".repeat(40));
  assert.equal(JSON.parse(calls[1].options.body).maxFileCount, 10000);
});

test("native hashes skip old uploads without downloading content and detect same-size edits", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "blazesync-native-"));
  try {
    const file = path.join(root, "code");
    await fs.writeFile(file, "one");
    let sdkCalls = 0;
    const client = { send: async () => { sdkCalls++; throw new Error("Unexpected per-file request"); } };
    registerNativeIndex(client, connection, async (url) => response(url.endsWith("b2_authorize_account") ? authorization : {
      files: [{ fileName: "code", fileId: "version", contentLength: 3, contentSha1: crypto.createHash("sha1").update("one").digest("hex"), fileInfo: {} }],
    }));
    const entries = [{ key: "code", file, size: 3 }];
    await inspectUploadDestinations(client, "bucket", entries);
    await compareUploadContents(client, "bucket", entries);
    assert.equal(entries[0].unchanged, true);
    await fs.writeFile(file, "two");
    await compareUploadContents(client, "bucket", entries);
    assert.equal(entries[0].unchanged, false);
    assert.equal(sdkCalls, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("native index failure falls back to S3 listings", async () => {
  let calls = 0;
  const client = { send: async (command) => {
    calls++;
    assert.equal(command.constructor.name, "ListObjectsV2Command");
    return { Contents: [{ Key: "code", Size: 3 }] };
  } };
  registerNativeIndex(client, connection, async () => ({ ok: false, status: 403 }));
  const entries = [{ key: "code", size: 3 }];
  await inspectUploadDestinations(client, "bucket", entries);
  assert.equal(entries[0].existing, true);
  assert.equal(calls, 1);
});

test("native index rejects repeated pages and out-of-prefix records", async () => {
  for (const page of [
    { files: [{ fileName: "outside", contentLength: 3 }] },
    { files: [], nextFileName: "folder/repeat" },
  ]) {
    const client = {};
    registerNativeIndex(client, connection, async (url) => response(url.endsWith("b2_authorize_account") ? authorization : page));
    await assert.rejects(nativeFileIndex(client, "bucket", "folder/"), /invalid|repeated/);
  }
});

test("cancelled comparisons never start a local content read or cloud request", async () => {
  const controller = new AbortController();
  controller.abort();
  const entry = { key: "file", file: "/does-not-exist", size: 3, existing: true,
    remote: { Size: 3, ContentLength: 3, Metadata: { "blazesync-sha256": "hash" } } };
  await assert.rejects(compareUploadContents({}, "bucket", [entry], () => {}, controller.signal), { name: "AbortError" });
});
