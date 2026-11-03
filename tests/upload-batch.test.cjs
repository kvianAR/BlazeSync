const { test } = require("node:test");
const assert = require("node:assert/strict");
const { consumeUploadBatch } = require("../electron/upload-batch.cjs");

test("47,013 uploads keep one task in flight and let timers run", async () => {
  const entries = Array.from({ length: 47013 }, (_, index) => ({ key: String(index) }));
  const controller = new AbortController();
  let active = 0;
  let peak = 0;
  let ticks = 0;
  let latest;
  const heartbeat = setInterval(() => ticks++, 1);
  try {
    const result = await consumeUploadBatch(entries, async () => {
      peak = Math.max(peak, ++active);
      await Promise.resolve();
      active--;
      return 3;
    }, (progress) => { latest = progress; }, controller.signal);
    assert.equal(peak, 1);
    assert.equal(result.completed, 47013);
    assert.equal(result.loaded, 47013 * 3);
    assert.equal(latest.total, 47013);
    assert.ok(ticks > 0, "timers must remain responsive during a large queue");
  } finally {
    clearInterval(heartbeat);
  }
});

test("cancelling a batch prevents every remaining file from starting", async () => {
  const controller = new AbortController();
  let uploads = 0;
  await assert.rejects(consumeUploadBatch(Array(100).fill({}), async () => {
    if (++uploads === 3) controller.abort();
    return 1;
  }, () => {}, controller.signal), { name: "AbortError" });
  assert.equal(uploads, 3);
});

test("the first failed upload stops a batch before it can hammer the provider", async () => {
  let uploads = 0;
  await assert.rejects(consumeUploadBatch(Array(100).fill({}), async () => {
    if (++uploads === 2) throw new Error("Cloud cap exceeded");
    return 1;
  }, () => {}, new AbortController().signal), /Cloud cap exceeded/);
  assert.equal(uploads, 2);
});

test("parallel batches use four workers and account for every completed byte", async () => {
  let active = 0;
  let peak = 0;
  const entries = Array.from({ length: 100 }, (_, index) => ({ size: index + 1 }));
  const result = await consumeUploadBatch(entries, async (entry) => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    return entry.size;
  }, () => {}, new AbortController().signal, { concurrency: 4 });
  assert.equal(peak, 4);
  assert.equal(result.loaded, 5050);
  assert.equal(result.completed, 100);
});

test("parallel batch errors abort peers and wait for cleanup before returning", async () => {
  const controller = new AbortController();
  let active = 0;
  let started = 0;
  await assert.rejects(consumeUploadBatch(Array(100).fill({}), async () => {
    const current = ++started;
    active++;
    try {
      await new Promise((resolve) => setTimeout(resolve, current === 1 ? 1 : 5));
      if (current === 1) throw new Error("first failure");
      controller.signal.throwIfAborted();
      return 1;
    } finally { active--; }
  }, () => {}, controller.signal, {
    concurrency: 4,
    onError: (error) => controller.abort(error),
  }), /first failure/);
  assert.equal(started, 4);
  assert.equal(active, 0);
});
