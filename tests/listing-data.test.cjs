const { test } = require("node:test");
const assert = require("node:assert/strict");
test("automatic refresh preserves loaded pages and deduplicates keys", async () => {
  const { refreshPages } = await import("../src/listing-data.mjs");
  let calls = 0;
  const r = await refreshPages(async (token) => {
    calls++;
    return token
      ? { files: [{ key: "b" }, { key: "a" }], folders: ["folder/"] }
      : { files: [{ key: "a" }], folders: ["folder/"], next: "next" };
  }, 3);
  assert.equal(calls, 2);
  assert.deepEqual(
    r.files.map((f) => f.key),
    ["a", "b"],
  );
  assert.deepEqual(r.folders, ["folder/"]);
});
test("initial listing stays paginated instead of reading entire bucket", async () => {
  const { refreshPages } = await import("../src/listing-data.mjs");
  let n = 0;
  const r = await refreshPages(async () => {
    n++;
    return { files: [{ key: "a" }], next: "next" };
  });
  assert.equal(n, 1);
  assert.equal(r.next, "next");
});
test("listing refresh rejects repeating tokens", async () => {
  const { refreshPages } = await import("../src/listing-data.mjs");
  await assert.rejects(
    refreshPages(async () => ({ files: [], next: "same" }), 100),
    /Repeated/,
  );
});
