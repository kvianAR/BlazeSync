const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateConnection,
  joinKey,
  copySource,
  backupKey,
  due,
} = require("../electron/helpers.cjs");
const valid = {
  endpoint: "https://s3.us-west-004.backblazeb2.com",
  keyId: "id",
  applicationKey: "secret",
};
test("connection accepts B2 S3 endpoint and derives its region", () => {
  const c = validateConnection(valid);
  assert.equal(c.region, "us-west-004");
  assert.equal(c.endpoint, valid.endpoint);
});
for (const endpoint of [
  "http://s3.us-west-004.backblazeb2.com",
  "https://evil.example",
  "https://s3.us-west-004.backblazeb2.com.evil.example",
  "https://s3.us-west-004.backblazeb2.com/path",
  "https://user:pass@s3.us-west-004.backblazeb2.com",
  "https://s3.us-west-004.backblazeb2.com?redirect=foo",
])
  test("rejects endpoint " + endpoint, () =>
    assert.throws(() => validateConnection({ ...valid, endpoint })),
  );
test("requires both credentials", () =>
  assert.throws(() => validateConnection({ ...valid, applicationKey: "" })));
test("backup preserves relative paths and blocks folder escape", () => {
  assert.equal(
    backupKey("Backups/project/", "/local/project", "/local/project/sub/a.txt"),
    "Backups/project/sub/a.txt",
  );
  assert.throws(() => backupKey("backup", "/local/project", "/local/secret"));
  assert.throws(() =>
    backupKey("backup", "/local/project", "/local/project-two/a"),
  );
});
test("object prefixes join exactly once", () => {
  assert.equal(joinKey("", "file"), "file");
  assert.equal(joinKey("folder/", "file"), "folder/file");
  assert.equal(joinKey("folder", "file"), "folder/file");
});
test("restore source safely encodes spaces and version IDs", () =>
  assert.equal(
    copySource("my-bucket", "a folder/a+#.txt", "v+/="),
    "my-bucket/a%20folder/a%2B%23.txt?versionId=v%2B%2F%3D",
  ));
test("scheduler only runs enabled idle jobs after their interval", () => {
  const j = { enabled: true, interval: 60, lastAttempt: 1000 };
  assert.equal(due(j, 3601000), true);
  assert.equal(due(j, 3600999), false);
  assert.equal(due({ ...j, running: true }, 3601000), false);
  assert.equal(due({ ...j, enabled: false }, 3601000), false);
  assert.equal(due({ ...j, lastAttempt: null }, 0), true);
});
const { isPhoto, canPreview } = require("../electron/helpers.cjs");
test("Photos includes uppercase extensions, HEIC and RAW without treating videos or archives as photos", () => {
  for (const key of ["a.JPG", "folder/photo.heic", "a.CR3", "a.nef", "a.webp"])
    assert.equal(isPhoto(key), true, key);
  for (const key of [
    "movie.mp4",
    "photo.jpg.zip",
    "README",
    "folder.jpg/file.pdf",
  ])
    assert.equal(isPhoto(key), false, key);
});
test("Only supported raster image formats are previewed", () => {
  assert.equal(canPreview("a.PNG"), true);
  assert.equal(canPreview("a.heic"), false);
  assert.equal(canPreview("a.cr3"), false);
  assert.equal(canPreview("a.svg"), false);
});
