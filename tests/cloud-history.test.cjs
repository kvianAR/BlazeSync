const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  historyPage,
  exactVersions,
  purgeVersions,
} = require("../electron/cloud-history.cjs");
test("history includes hidden files, prior versions and delete markers", async () => {
  const c = {
    send: async () => ({
      Versions: [
        {
          Key: "movie.MOV",
          VersionId: "old",
          IsLatest: false,
          Size: 162774343,
          LastModified: new Date("2026-11-02"),
        },
      ],
      DeleteMarkers: [
        {
          Key: "movie.MOV",
          VersionId: "hide",
          IsLatest: true,
          LastModified: new Date("2026-11-03"),
        },
      ],
    }),
  };
  const page = await historyPage(c, "bucket");
  assert.equal(page.entries.length, 2);
  assert.equal(page.entries[0].deleted, true);
  assert.equal(page.entries[0].latest, true);
  assert.equal(page.entries[1].size, 162774343);
});
test("exact version enumeration paginates and excludes adjacent names", async () => {
  let n = 0;
  const c = {
    send: async (command) => {
      assert.equal(command.input.Prefix, "file");
      return ++n === 1
        ? {
            Versions: [
              { Key: "file", VersionId: "one" },
              { Key: "file-adjacent", VersionId: "other" },
            ],
            IsTruncated: true,
            NextKeyMarker: "file",
            NextVersionIdMarker: "one",
          }
        : {
            DeleteMarkers: [{ Key: "file", VersionId: "hide", IsLatest: true }],
            IsTruncated: false,
          };
    },
  };
  const entries = await exactVersions(c, "bucket", "file");
  assert.deepEqual(
    entries.map((e) => e.id),
    ["one", "hide"],
  );
  assert.equal(n, 2);
});
test("permanent purge deletes explicit version IDs and verifies cloud history", async () => {
  const calls = [];
  const c = {
    send: async (cmd) => {
      calls.push(cmd);
      return {};
    },
  };
  const count = await purgeVersions(c, "bucket", "file", [
    { id: "v1" },
    { id: "hide" },
  ]);
  assert.equal(count, 2);
  assert.deepEqual(
    calls.slice(0, 2).map((c) => c.input),
    [
      { Bucket: "bucket", Key: "file", VersionId: "v1" },
      { Bucket: "bucket", Key: "file", VersionId: "hide" },
    ],
  );
  assert.equal(calls[2].constructor.name, "ListObjectVersionsCommand");
});
test("purge does not claim success if cloud versions remain", async () => {
  const c = {
    send: async (cmd) =>
      cmd.constructor.name === "ListObjectVersionsCommand"
        ? { Versions: [{ Key: "file", VersionId: "still-there" }] }
        : {},
  };
  await assert.rejects(
    purgeVersions(c, "bucket", "file", [{ id: "old" }]),
    /versions remain/,
  );
});
test("purge honors provider permission and retention failures", async () => {
  const e = new Error("retention");
  e.name = "AccessDenied";
  await assert.rejects(
    purgeVersions(
      {
        send: async () => {
          throw e;
        },
      },
      "bucket",
      "file",
      [{ id: "v" }],
    ),
    e,
  );
});
test("history rejects malformed or repeated pagination rather than hanging", async () => {
  await assert.rejects(
    exactVersions(
      { send: async () => ({ IsTruncated: true }) },
      "bucket",
      "file",
    ),
    /next marker/,
  );
  await assert.rejects(
    exactVersions(
      {
        send: async () => ({
          IsTruncated: true,
          NextKeyMarker: "file",
          NextVersionIdMarker: "same",
        }),
      },
      "bucket",
      "file",
    ),
    /repeated/,
  );
});
