const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { inspectUploadDestinations, compareUploadContents } = require("../electron/upload-destination.cjs");

test("47,013 new files use one listing and zero per-file cloud requests", async () => {
  const entries = Array.from({ length: 47013 }, (_, i) => ({ key: `project/file-${i}`, size: 1 }));
  let requests = 0;
  const client = { async send(command) {
    requests++;
    assert.equal(command.constructor.name, "ListObjectsV2Command");
    assert.equal(command.input.Prefix, "project/");
    return {};
  } };
  await inspectUploadDestinations(client, "bucket", entries);
  await compareUploadContents(client, "bucket", entries);
  assert.equal(requests, 1);
  assert.ok(entries.every((entry) => !entry.existing && !entry.unchanged));
});

test("paginated listings preserve exact names, folder markers and missing files", async () => {
  const entries = [{ key: "dir/", directory: true }, { key: "dir/a" }, { key: "dir/b" }];
  const inputs = [];
  const client = { async send(command) {
    inputs.push(command.input);
    return inputs.length === 1
      ? { Contents: [{ Key: "dir/", Size: 0 }], IsTruncated: true, NextContinuationToken: "next" }
      : { Contents: [{ Key: "dir/a", Size: 4 }, { Key: "dir/b-other", Size: 8 }] };
  } };
  await inspectUploadDestinations(client, "bucket", entries);
  assert.equal(inputs[1].ContinuationToken, "next");
  assert.deepEqual(entries.map((entry) => entry.existing), [true, true, false]);
  assert.equal(entries[0].unchanged, true);
});

test("incomplete and repeating listing pages fail before planning uploads", async () => {
  for (const page of [{ IsTruncated: true }, { IsTruncated: true, NextContinuationToken: "repeat" }]) {
    await assert.rejects(inspectUploadDestinations({ send: async () => page }, "b", [{ key: "a" }]), /incomplete|repeated/);
  }
});

test("same-size changes are checked with bounded concurrency, size changes avoid reads", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "blazesync-compare-"));
  try {
    const file = path.join(folder, "code");
    await fs.writeFile(file, "new");
    const digest = createHash("sha256").update("new").digest("hex");
    const entries = Array.from({ length: 20 }, (_, i) => ({ key: String(i), file, size: 3, existing: true, remote: { Size: 3 } }));
    entries.push({ key: "size-changed", size: 4, existing: true, remote: { Size: 3 } });
    let running = 0, peak = 0, reads = 0;
    const client = { async send(command) {
      assert.equal(command.constructor.name, "HeadObjectCommand");
      reads++;
      peak = Math.max(peak, ++running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return { ContentLength: 3, Metadata: { "blazesync-sha256": command.input.Key === "0" ? "different" : digest } };
    } };
    await compareUploadContents(client, "bucket", entries);
    assert.equal(reads, 20);
    assert.ok(peak > 1 && peak <= 2);
    assert.equal(entries[0].unchanged, false);
    assert.ok(entries.slice(1, 20).every((entry) => entry.unchanged));
    assert.ok(!entries[20].unchanged);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test("read failure waits for in-flight checks and propagates the provider error", async () => {
  let active = 0;
  const client = { async send() {
    active++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    throw new Error("Backblaze cap exceeded");
  } };
  const entries = Array.from({ length: 20 }, (_, i) => ({ key: String(i), size: 3, existing: true, remote: { Size: 3 } }));
  await assert.rejects(compareUploadContents(client, "bucket", entries), /cap exceeded/);
  assert.equal(active, 0);
});
