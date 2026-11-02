const { test } = require("node:test");
const assert = require("node:assert/strict");
const { estimateStorage, scanStorage } = require("../electron/billing.cjs");
const GB = 1_000_000_000;

test("first 10 decimal GB are free and public rate applies only above allowance", () => {
  assert.equal(estimateStorage(0).monthlyUsd, 0);
  assert.equal(estimateStorage(10 * GB).monthlyUsd, 0);
  assert.ok(Math.abs(estimateStorage(100 * GB).monthlyUsd - 0.6255) < 1e-9);
  assert.ok(Math.abs(estimateStorage(1000 * GB).monthlyUsd - 6.8805) < 1e-9);
  assert.equal(estimateStorage(3 * GB).remainingFreeBytes, 7 * GB);
});
test("restricted scope exposes an allowance-dependent range and unknown free balance", () => {
  const value = estimateStorage(100 * GB, false);
  assert.equal(value.remainingFreeBytes, null);
  assert.ok(Math.abs(value.visibleMaximumUsd - 0.695) < 1e-9);
  assert.equal(value.accountComplete, false);
});
test("invalid usage cannot produce a plausible cost", () => {
  for (const value of [-1, NaN, Infinity, 1.2])
    assert.throws(() => estimateStorage(value));
});
test("all bucket versions are summed and 10 GB allowance applies once across the account", async () => {
  const client = {
    send: async (command) =>
      command.constructor.name === "ListObjectVersionsCommand"
        ? {
            Versions: [
              { Key: "current", IsLatest: true, Size: 30 * GB },
              { Key: "old", IsLatest: false, Size: 20 * GB },
            ],
            DeleteMarkers: [{ Key: "old", IsLatest: true }],
          }
        : {},
  };
  const result = await scanStorage(client, ["first", "second"], "account");
  assert.equal(result.totalBytes, 100 * GB);
  assert.equal(result.currentBytes, 60 * GB);
  assert.equal(result.retainedBytes, 40 * GB);
  assert.equal(result.estimate.chargedBytes, 90 * GB);
  assert.equal(result.estimate.accountComplete, true);
  assert.equal(result.rows[0].deleteMarkers, 1);
});
test("billing follows version and multipart part pagination and counts unfinished stored bytes", async () => {
  const calls = [];
  const client = {
    send: async (command) => {
      const type = command.constructor.name;
      calls.push(type);
      if (type === "ListObjectVersionsCommand")
        return command.input.KeyMarker
          ? { Versions: [{ Key: "old", Size: 20, IsLatest: false }] }
          : {
              Versions: [{ Key: "live", Size: 100, IsLatest: true }],
              IsTruncated: true,
              NextKeyMarker: "live",
              NextVersionIdMarker: "v1",
            };
      if (type === "ListMultipartUploadsCommand")
        return { Uploads: [{ Key: "unfinished", UploadId: "u" }] };
      if (type === "ListPartsCommand")
        return command.input.PartNumberMarker
          ? { Parts: [{ Size: 7 }] }
          : {
              Parts: [{ Size: 5 }],
              IsTruncated: true,
              NextPartNumberMarker: "1",
            };
      throw new Error(type);
    },
  };
  const result = await scanStorage(client, ["b"], "account");
  assert.equal(result.totalBytes, 132);
  assert.equal(result.unfinishedBytes, 12);
  assert.equal(
    calls.filter((type) => type === "ListObjectVersionsCommand").length,
    2,
  );
  assert.equal(calls.filter((type) => type === "ListPartsCommand").length, 2);
});
test("an unreadable bucket yields an explicit partial estimate", async () => {
  const result = await scanStorage(
    {
      send: async (command) => {
        if (command.input.Bucket === "private") throw new Error("AccessDenied");
        return command.constructor.name === "ListObjectVersionsCommand"
          ? { Versions: [{ Key: "a", IsLatest: true, Size: GB }] }
          : {};
      },
    },
    ["visible", "private"],
    "account",
  );
  assert.equal(result.complete, false);
  assert.equal(result.estimate.accountComplete, false);
  assert.ok(result.rows[1].errors.length);
  assert.equal(result.totalBytes, GB);
});
test("repeated pagination becomes an explicit incomplete result rather than an endless scan", async () => {
  const result = await scanStorage(
    {
      send: async (command) =>
        command.constructor.name === "ListObjectVersionsCommand"
          ? { IsTruncated: true, NextKeyMarker: "same" }
          : {},
    },
    ["b"],
    "account",
  );
  assert.equal(result.complete, false);
  assert.match(result.rows[0].errors[0], /Repeated/);
});
