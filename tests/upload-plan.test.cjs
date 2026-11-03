const { test } = require("node:test");
const assert = require("node:assert/strict");
const { prepareUploadPlan } = require("../electron/upload-plan.cjs");

test("merging local name collisions uses the last selected source once", async () => {
  const entries = [
    { key: "code.txt", file: "/first/code.txt" },
    { key: "code.txt", file: "/second/code.txt" },
  ];
  const plan = await prepareUploadPlan(entries, false);
  assert.deepEqual(
    plan.pending.map((entry) => entry.file),
    ["/second/code.txt"],
  );
  assert.equal(plan.merged, 1);
  assert.equal(plan.skipped, 0);
});
test("a last selected unchanged source prevents an earlier source from overwriting it", async () => {
  const plan = await prepareUploadPlan(
    [
      { key: "same", file: "changed" },
      { key: "same", file: "original", unchanged: true },
    ],
    false,
  );
  assert.deepEqual(plan.pending, []);
  assert.equal(plan.skipped, 1);
});
test("keep both preserves all local collisions and existing cloud files", async () => {
  let copies = 0;
  const plan = await prepareUploadPlan(
    [
      { key: "code.txt", file: "one" },
      { key: "code.txt", file: "two" },
      { key: "old.txt", existing: true, unchanged: true },
    ],
    true,
    async (key) => key + "-copy-" + ++copies,
  );
  assert.deepEqual(
    plan.pending.map((entry) => entry.key),
    ["code.txt", "code.txt-copy-1", "old.txt-copy-2"],
  );
  assert.equal(plan.skipped, 0);
});
test("repeated folder markers produce one marker while existing markers are skipped", async () => {
  const plan = await prepareUploadPlan(
    [
      { key: "dir/", directory: true },
      { key: "dir/", directory: true },
      { key: "old/", directory: true, existing: true, unchanged: true },
    ],
    true,
  );
  assert.deepEqual(
    plan.pending.map((entry) => entry.key),
    ["dir/"],
  );
});
test("copy name collisions fail before any upload is queued", async () => {
  await assert.rejects(
    prepareUploadPlan(
      [{ key: "old", existing: true }, { key: "reserved" }],
      true,
      async () => "reserved",
    ),
    /conflicts/,
  );
});
