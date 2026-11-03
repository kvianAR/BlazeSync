const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FolderMetrics } = require("../electron/folder-metrics.cjs");
const item = (Key, Size) => ({ Key, Size });
test("root size includes direct files and all nested folder descendants, excludes markers", async () => {
  const c = {
    send: async () => ({
      Contents: [
        item("direct.txt", 10),
        item("Agency/", 0),
        item("Agency/sub/a.pdf", 20),
        item("Agency/b.pdf", 30),
        item("Empty/", 0),
      ],
    }),
  };
  const r = await new FolderMetrics().read(c, "bucket");
  assert.equal(r.bytes, 60);
  assert.equal(r.files, 3);
  assert.deepEqual(r.folders, {
    "Agency/": { bytes: 50, files: 2 },
    "Empty/": { bytes: 0, files: 0 },
  });
  assert.equal(r.complete, true);
});
test("nested size uses exact prefix and only immediate child folder groupings", async () => {
  const r = await new FolderMetrics().read(
    {
      send: async (cmd) => {
        assert.equal(cmd.input.Prefix, "Agency/");
        assert.equal(cmd.input.Delimiter, undefined);
        return {
          Contents: [
            item("Agency/", 0),
            item("Agency/a", 5),
            item("Agency/sub/deep/x", 15),
          ],
        };
      },
    },
    "bucket",
    "Agency/",
  );
  assert.equal(r.bytes, 20);
  assert.deepEqual(r.folders, { "Agency/sub/": { bytes: 15, files: 1 } });
});
test("metrics sums every page beyond 1000 objects", async () => {
  let n = 0;
  const r = await new FolderMetrics().read(
    {
      send: async (cmd) =>
        ++n === 1
          ? {
              Contents: Array.from({ length: 1000 }, (_, i) =>
                item("Folder/" + i, 2),
              ),
              IsTruncated: true,
              NextContinuationToken: "next",
            }
          : { Contents: [item("Folder/last", 7)] },
    },
    "bucket",
  );
  assert.equal(r.bytes, 2007);
  assert.equal(r.files, 1001);
  assert.equal(r.pages, 2);
  assert.equal(r.folders["Folder/"].bytes, 2007);
});
test("empty folders return confirmed zero, not unknown", async () => {
  const r = await new FolderMetrics().read(
    { send: async () => ({ Contents: [] }) },
    "bucket",
    "empty/",
  );
  assert.equal(r.bytes, 0);
  assert.equal(r.files, 0);
  assert.equal(r.complete, true);
});
test("failures never fabricate a zero size", async () => {
  await assert.rejects(
    new FolderMetrics().read(
      {
        send: async () => {
          throw new Error("AccessDenied");
        },
      },
      "bucket",
    ),
    /AccessDenied/,
  );
});
test("cache reuses complete sizes; forced refresh and invalidation see changed data", async () => {
  let calls = 0,
    size = 10;
  const c = {
      send: async () => {
        calls++;
        return { Contents: [item("x", size)] };
      },
    },
    m = new FolderMetrics();
  await m.read(c, "b");
  size = 20;
  assert.equal((await m.read(c, "b")).bytes, 10);
  assert.equal(calls, 1);
  assert.equal((await m.read(c, "b", "", true)).bytes, 20);
  size = 30;
  m.invalidate();
  assert.equal((await m.read(c, "b")).bytes, 30);
  assert.equal(calls, 3);
});
test("cache does not leak sizes across clients/accounts", async () => {
  const m = new FolderMetrics();
  await m.read({ send: async () => ({ Contents: [item("x", 10)] }) }, "b");
  assert.equal(
    (await m.read({ send: async () => ({ Contents: [item("x", 99)] }) }, "b"))
      .bytes,
    99,
  );
});
test("parallel callers share the same scan", async () => {
  let calls = 0,
    resolve;
  const c = {
      send: () => {
        calls++;
        return new Promise((r) => {
          resolve = r;
        });
      },
    },
    m = new FolderMetrics();
  const a = m.read(c, "b"),
    b = m.read(c, "b");
  resolve({ Contents: [item("x", 5)] });
  assert.equal((await a).bytes, 5);
  assert.equal((await b).bytes, 5);
  assert.equal(calls, 1);
});
test("malformed/repeated pagination stops instead of claiming a full total", async () => {
  for (const response of [
    { IsTruncated: true },
    { NextContinuationToken: "loop" },
  ])
    await assert.rejects(
      new FolderMetrics().read({ send: async () => response }, "b"),
      /continuation token|repeated/,
    );
});
test("invalid sizes and out-of-prefix results are rejected", async () => {
  for (const entry of [item("P/a", -1), item("P/a", NaN), item("outside", 5)])
    await assert.rejects(
      new FolderMetrics().read(
        { send: async () => ({ Contents: [entry] }) },
        "b",
        "P/",
      ),
      /invalid|outside/,
    );
});

test("upload changes do not start overlapping folder-size scans", async () => {
  const m = new FolderMetrics();
  let calls = 0;
  let release;
  const client = { send: () => {
    calls++;
    return new Promise((resolve) => { release = resolve; });
  } };
  const first = m.read(client, "bucket");
  m.invalidate();
  const second = m.read(client, "bucket", "", true);
  m.invalidate();
  const third = m.read(client, "bucket", "", true);
  assert.equal(calls, 1);
  release({ Contents: [item("file", 5)] });
  await Promise.all([first, second, third]);
  const refreshed = m.read(client, "bucket");
  assert.equal(calls, 2, "an invalidated scan must not become a cached final size");
  release({ Contents: [item("file", 10)] });
  assert.equal((await refreshed).bytes, 10);
});
