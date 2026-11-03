const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TransferPool } = require("../electron/transfer-pool.cjs");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("transfers run four at a time while equal destinations stay ordered", async () => {
  const pool = new TransferPool(4);
  let active = 0;
  let peak = 0;
  const seen = new Set();
  const tasks = Array.from({ length: 40 }, (_, index) => pool.schedule(async () => {
    const key = index % 10;
    assert.ok(!seen.has(key));
    seen.add(key);
    peak = Math.max(peak, ++active);
    await sleep(2);
    active--;
    seen.delete(key);
    return index;
  }, index % 10));
  assert.deepEqual(await Promise.all(tasks), Array.from({ length: 40 }, (_, index) => index));
  assert.equal(peak, 4);
});

test("a failed task releases its slot for the next transfer", async () => {
  const pool = new TransferPool(1);
  const first = pool.schedule(async () => { throw new Error("provider failure"); }, "same");
  const second = pool.schedule(async () => "recovered", "same");
  await assert.rejects(first, /provider failure/);
  assert.equal(await second, "recovered");
});

test("weighted upload slots allow twelve tiny files or four large files", async () => {
  for (const weight of [1, 3]) {
    const pool = new TransferPool(12);
    let active = 0;
    let peak = 0;
    await Promise.all(Array.from({ length: 36 }, (_, index) => pool.schedule(async () => {
      peak = Math.max(peak, ++active);
      await sleep(2);
      active--;
    }, index, weight)));
    assert.equal(peak, 12 / weight);
    assert.equal(pool.used, 0);
  }
});
