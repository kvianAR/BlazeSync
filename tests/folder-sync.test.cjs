const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const {
  hashFile,
  unchangedFile,
  syncArguments,
  folderDestination,
} = require("../electron/folder-sync.cjs");
const { workflowXml, servicePath } = require("../electron/finder-sync.cjs");
async function localFile(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "blazesync-sync-"));
  const file = path.join(root, "code.txt");
  await fs.writeFile(file, "one");
  try {
    await run(file);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
test("content hash skips unchanged data despite changed timestamps", async () =>
  localFile(async (file) => {
    const hash = await hashFile(file);
    await fs.utimes(file, new Date(), new Date());
    assert.equal(
      await unchangedFile({}, "bucket", "code", file, {
        ContentLength: 3,
        Metadata: { "blazesync-sha256": hash },
      }),
      true,
    );
    await fs.writeFile(file, "two");
    assert.equal(
      await unchangedFile({}, "bucket", "code", file, {
        ContentLength: 3,
        Metadata: { "blazesync-sha256": hash },
      }),
      false,
    );
  }));
test("legacy file comparison reads pinned cloud bytes and detects same-size edits", async () =>
  localFile(async (file) => {
    let request;
    let reads = 0;
    const client = {
      send: async (command) => {
        request = command.input;
        reads++;
        return {
          Body: Readable.from([
            Buffer.from(
              command.input.VersionId === "new-version" ? "two" : "one",
            ),
          ]),
        };
      },
    };
    const head = { ContentLength: 3, VersionId: "old-version", ETag: '"etag"' };
    assert.equal(
      await unchangedFile(client, "bucket", "code", file, head),
      true,
    );
    assert.equal(request.VersionId, "old-version");
    assert.equal(request.IfMatch, '"etag"');
    await fs.writeFile(file, "two");
    assert.equal(
      await unchangedFile(client, "bucket", "code", file, head),
      false,
    );
    assert.equal(reads, 1);
    assert.equal(
      await unchangedFile(client, "bucket", "code", file, {
        ...head,
        VersionId: "new-version",
      }),
      true,
    );
    assert.equal(reads, 2);
  }));
test("missing files and size mismatches are uploaded without remote content reads", async () =>
  localFile(async (file) => {
    assert.equal(await unchangedFile({}, "bucket", "code", file, null), false);
    assert.equal(
      await unchangedFile({}, "bucket", "code", file, { ContentLength: 4 }),
      false,
    );
  }));
test("Finder arguments preserve folder paths without shell evaluation", () => {
  assert.deepEqual(
    syncArguments(["app", "--sync-path", "/my folder/$(touch nope)"]),
    ["/my folder/$(touch nope)"],
  );
  assert.deepEqual(syncArguments(["app"]), []);
  assert.equal(
    servicePath("/test"),
    "/test/Library/Services/Sync with BlazeSync.workflow",
  );
  const xml = workflowXml("/app's folder/BlazeSync");
  assert.ok(xml.includes("--sync-path"));
  assert.ok(xml.includes("&amp;"));
  assert.ok(xml.includes('"$@"'));
  assert.ok(xml.includes("'\\''"));
});

test("cancellation stops content hashing before upload", async () =>
  localFile(async (file) => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(hashFile(file, controller.signal), {
      name: "AbortError",
    });
  }));

test("sync reuses the current cloud folder when its name matches the local folder", () => {
  assert.equal(folderDestination("", "/local/Project"), "Project/");
  assert.equal(
    folderDestination("Projects/", "/local/Project"),
    "Projects/Project/",
  );
  assert.equal(
    folderDestination("Projects/Project/", "/local/Project"),
    "Projects/Project/",
  );
  assert.equal(folderDestination("Project/", "/local/Project"), "Project/");
});
