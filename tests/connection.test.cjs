const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  discoverConnection,
  healthFromError,
} = require("../electron/connection.cjs");
const input = { keyId: " key-id ", applicationKey: " secret " };
const response = (
  storage = {
    s3ApiUrl: "https://s3.us-west-004.backblazeb2.com",
    allowed: { buckets: [{ id: "one", name: "my-bucket" }] },
  },
) => ({
  ok: true,
  status: 200,
  json: async () => ({ apiInfo: { storageApi: storage } }),
});
test("two credentials discover endpoint, region and restricted bucket using v4", async () => {
  let target, options;
  const c = await discoverConnection(input, async (u, o) => {
    target = u;
    options = o;
    return response();
  });
  assert.equal(c.bucket, "my-bucket");
  assert.equal(c.region, "us-west-004");
  assert.equal(c.keyId, "key-id");
  assert.deepEqual(c.buckets, ["my-bucket"]);
  assert.ok(target.endsWith("/v4/b2_authorize_account"));
  assert.equal(
    options.headers.Authorization,
    "Basic " + Buffer.from("key-id:secret").toString("base64"),
  );
  assert.equal(options.redirect, "error");
});
test("multi-bucket keys discover all permitted names", async () => {
  const c = await discoverConnection(input, async () =>
    response({
      s3ApiUrl: "https://s3.eu-central-003.backblazeb2.com",
      allowed: {
        buckets: [
          { id: "a", name: "first" },
          { id: "b", name: "second" },
        ],
      },
    }),
  );
  assert.deepEqual(c.buckets, ["first", "second"]);
  assert.equal(c.bucket, "");
});
test("asks for bucket name only if the key hides it", async () => {
  const mock = async () =>
    response({
      s3ApiUrl: "https://s3.us-west-004.backblazeb2.com",
      allowed: { buckets: [{ id: "a", name: null }] },
    });
  await assert.rejects(discoverConnection(input, mock), /BUCKET_NAME_REQUIRED/);
  const c = await discoverConnection({ ...input, bucket: "private" }, mock);
  assert.equal(c.bucket, "private");
});
test("authorization retries temporary service failures", async () => {
  let n = 0;
  const c = await discoverConnection(
    input,
    async () => (++n < 3 ? { status: 503, ok: false } : response()),
    async () => {},
  );
  assert.equal(n, 3);
  assert.equal(c.bucket, "my-bucket");
});
test("invalid credentials do not loop retries", async () => {
  let n = 0;
  await assert.rejects(
    discoverConnection(
      input,
      async () => {
        n++;
        return { status: 401, ok: false };
      },
      async () => {},
    ),
    /key was rejected/,
  );
  assert.equal(n, 1);
});
test("network failures preserve saved-session intent without exposing secrets", async () => {
  await assert.rejects(
    discoverConnection(
      input,
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => {},
    ),
    (e) =>
      e.message.includes("saved connection has not been removed") &&
      !e.message.includes("secret"),
  );
});
test("discovery rejects an endpoint outside Backblaze", async () => {
  await assert.rejects(
    discoverConnection(input, async () =>
      response({ s3ApiUrl: "https://evil.example", allowed: {} }),
    ),
    /B2 S3 endpoint/,
  );
});
test("health separates network loss, key rejection and per-action permissions", () => {
  assert.equal(healthFromError({ code: "ENOTFOUND" }), "offline");
  assert.equal(healthFromError({ name: "InvalidAccessKeyId" }), "key-error");
  assert.equal(
    healthFromError({
      name: "AccessDenied",
      $metadata: { httpStatusCode: 403 },
    }),
    null,
  );
});
