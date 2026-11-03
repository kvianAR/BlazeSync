const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { Readable } = require("node:stream");
const { createHash } = require("node:crypto");
const { downloadObject, RANGE_SIZE, RANGE_THRESHOLD } = require("../electron/download.cjs");
const source = Buffer.alloc(RANGE_THRESHOLD);
for (let part = 0; part < 4; part++) source.fill(part + 1, part * RANGE_SIZE, (part + 1) * RANGE_SIZE);
const digest = createHash("sha256").update(source).digest("hex");

async function withFile(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "blazesync-range-"));
  try { await run(path.join(root, "download.part")); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}
async function fileHash(file) {
  const hash = createHash("sha256");
  for await (const chunk of require("node:fs").createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
function fixture(options = {}) {
  const requests = [];
  let active = 0;
  let peak = 0;
  return {
    requests,
    get peak() { return peak; },
    async send(command, { abortSignal } = {}) {
      requests.push(command.input);
      abortSignal?.throwIfAborted();
      if (command.constructor.name === "HeadObjectCommand")
        return { ContentLength: source.length, ETag: '"pinned"', VersionId: "version-1" };
      if (options.changed) throw Object.assign(new Error("PreconditionFailed"), { $metadata: { httpStatusCode: 412 } });
      const match = command.input.Range?.match(/bytes=(\d+)-(\d+)/);
      const start = match && !options.ignoreRange ? Number(match[1]) : 0;
      const end = match && !options.ignoreRange ? Number(match[2]) : source.length - 1;
      const body = Readable.from((async function* () {
        active++;
        peak = Math.max(peak, active);
        try {
          for (let offset = start; offset <= end; offset += 65536) {
            abortSignal?.throwIfAborted();
            yield source.subarray(offset, Math.min(end + 1, offset + 65536));
          }
        } finally { active--; }
      })());
      return {
        ContentLength: end - start + 1,
        ContentRange: match && !options.ignoreRange ? `bytes ${start}-${end}/${source.length}` : undefined,
        Body: body,
      };
    },
  };
}

test("large downloads use four pinned ranges and assemble identical bytes", async () => withFile(async (file) => {
  const client = fixture();
  let loaded = 0;
  const size = await downloadObject(client, { Bucket: "b", Key: "large" }, file, {
    size: source.length,
    signal: new AbortController().signal,
    progress: (value, total) => { assert.ok(value >= loaded); loaded = value; assert.equal(total, source.length); },
  });
  assert.equal(size, source.length);
  assert.equal(loaded, source.length);
  assert.equal(client.peak, 4);
  assert.equal(client.requests.length, 5);
  assert.ok(client.requests.slice(1).every((input) => input.VersionId === "version-1" && input.IfMatch === '"pinned"'));
  assert.equal(await fileHash(file), digest);
}));

test("servers ignoring Range fall back to a verified full stream", async () => withFile(async (file) => {
  await downloadObject(fixture({ ignoreRange: true }), { Bucket: "b", Key: "large" }, file, {
    size: source.length, signal: new AbortController().signal, progress: () => {},
  });
  assert.equal(await fileHash(file), digest);
}));

test("changed cloud files fail instead of mixing versions", async () => withFile(async (file) => {
  await assert.rejects(downloadObject(fixture({ changed: true }), { Bucket: "b", Key: "large" }, file, {
    size: source.length, signal: new AbortController().signal, progress: () => {},
  }), /PreconditionFailed/);
}));

test("cancellation stops ranged downloads and closes the temporary file", async () => withFile(async (file) => {
  const controller = new AbortController();
  await assert.rejects(downloadObject(fixture(), { Bucket: "b", Key: "large" }, file, {
    size: source.length, signal: controller.signal,
    progress: (loaded) => { if (loaded) controller.abort(); },
  }), { name: "AbortError" });
  await fs.rm(file);
}));

test("small and empty downloads use one GET without a metadata round trip", async () => withFile(async (file) => {
  let requests = 0;
  const client = { async send(command) {
    requests++;
    assert.equal(command.constructor.name, "GetObjectCommand");
    return { ContentLength: 0, Body: Readable.from([]) };
  } };
  await downloadObject(client, { Bucket: "b", Key: "empty" }, file, {
    size: 0, signal: new AbortController().signal, progress: () => {},
  });
  assert.equal(requests, 1);
  assert.equal((await fs.stat(file)).size, 0);
}));
