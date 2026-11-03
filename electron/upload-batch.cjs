const { setImmediate } = require("node:timers/promises");

async function consumeUploadBatch(entries, upload, progress, signal, options = {}) {
  const { concurrency = 1, onError } = options;
  let next = 0;
  let completed = 0;
  let loaded = 0;
  let failure;
  await setImmediate();
  async function worker() {
    try {
      while (!failure && next < entries.length) {
        signal.throwIfAborted();
        const entry = entries[next++];
        const bytes = await upload(entry);
        loaded += bytes || 0;
        signal.throwIfAborted();
        progress({ completed: ++completed, loaded, total: entries.length });
        // Give window events and cancellation time even when a task finishes immediately.
        if (completed % 16 === 0) await setImmediate();
      }
    } catch (error) {
      if (!failure) {
        failure = error;
        await onError?.(error);
      }
    }
  }
  await Promise.allSettled(Array.from({ length: Math.min(concurrency, entries.length) }, worker));
  if (failure) throw failure;
  return { completed, loaded };
}
module.exports = { consumeUploadBatch };
