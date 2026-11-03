const fs = require("node:fs");
const { Writable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { GetObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const RANGE_THRESHOLD = 64 * 1024 * 1024;
const RANGE_SIZE = 16 * 1024 * 1024;

async function streamObject(client, input, temporary, signal, progress) {
  const object = await client.send(new GetObjectCommand(input), { abortSignal: signal });
  const size = object.ContentLength;
  let loaded = 0;
  progress(loaded, size);
  object.Body.on("data", (chunk) => {
    loaded += chunk.length;
    progress(loaded, size);
  });
  await pipeline(object.Body, fs.createWriteStream(temporary, { flags: "wx" }), { signal });
  if (loaded !== size) throw new Error("Download size verification failed");
  return size;
}

async function downloadObject(client, input, temporary, { size, signal, progress }) {
  if (!(size >= RANGE_THRESHOLD))
    return streamObject(client, input, temporary, signal, progress);
  const head = await client.send(new HeadObjectCommand(input), { abortSignal: signal });
  const pinned = { ...input, VersionId: head.VersionId, IfMatch: head.ETag };
  if (head.ContentLength < RANGE_THRESHOLD || !(head.VersionId || head.ETag))
    return streamObject(client, pinned, temporary, signal, progress);

  const total = head.ContentLength;
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  const file = await fs.promises.open(temporary, "wx");
  let next = 0;
  let loaded = 0;
  let failure;
  async function worker() {
    try {
      while (!failure && next < total) {
        combined.throwIfAborted();
        const start = next;
        const end = Math.min(total - 1, start + RANGE_SIZE - 1);
        next = end + 1;
        const object = await client.send(new GetObjectCommand({
          ...pinned, Range: `bytes=${start}-${end}`,
        }), { abortSignal: combined });
        if (object.ContentRange !== `bytes ${start}-${end}/${total}` || object.ContentLength !== end - start + 1) {
          object.Body.destroy();
          const error = new Error("Storage server did not honor the requested download range");
          error.name = "UnsupportedRange";
          throw error;
        }
        let position = start;
        const sink = new Writable({
          write(chunk, encoding, callback) {
            (async () => {
              if (position + chunk.length > end + 1)
                throw new Error("Download range size verification failed");
              let offset = 0;
              while (offset < chunk.length) {
                combined.throwIfAborted();
                const { bytesWritten } = await file.write(chunk, offset, chunk.length - offset, position);
                if (!bytesWritten) throw new Error("Could not write the downloaded file");
                position += bytesWritten;
                offset += bytesWritten;
                loaded += bytesWritten;
                progress(loaded, total);
              }
            })().then(() => callback(), callback);
          },
        });
        await pipeline(object.Body, sink, { signal: combined });
        if (position !== end + 1) throw new Error("Download range size verification failed");
      }
    } catch (error) {
      if (!failure) {
        failure = error;
        controller.abort(error);
      }
    }
  }
  try {
    progress(0, total);
    await file.truncate(total);
    await Promise.allSettled(Array.from({ length: 4 }, worker));
  } finally {
    await file.close();
  }
  if (failure?.name === "UnsupportedRange" && !signal.aborted) {
    await fs.promises.rm(temporary, { force: true });
    return streamObject(client, pinned, temporary, signal, progress);
  }
  if (failure) throw failure;
  if (loaded !== total) throw new Error("Download size verification failed");
  return total;
}
module.exports = { downloadObject, RANGE_THRESHOLD, RANGE_SIZE };
