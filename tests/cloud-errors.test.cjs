const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  diagnoseCloudError,
  isCloudLimit,
  CAPS_URL,
} = require("../electron/cloud-errors.cjs");
function rejected(message = "UnknownError", status = 403) {
  const error = new Error(message);
  error.name = "Unknown";
  error.$metadata = { httpStatusCode: status };
  return error;
}
test("opaque HEAD cap denial gets the provider's actual reason using at most one response byte", async () => {
  let request;
  const client = {
    send: async (command) => {
      request = command.input;
      throw rejected(
        "Cannot download file, download bandwidth or transaction (Class B) cap exceeded.",
      );
    },
  };
  const result = await diagnoseCloudError(
    client,
    "HeadObjectCommand",
    { Bucket: "bucket", Key: "folder/file" },
    rejected(),
  );
  assert.equal(result.name, "BackblazeCapExceeded");
  assert.equal(result.$metadata.httpStatusCode, 403);
  assert.match(result.message, /Caps & Alerts/);
  assert.equal(request.Range, "bytes=0-0");
});
test("cap diagnosis is cached to avoid repeated data probes", async () => {
  let calls = 0;
  const client = {
    send: async () => {
      calls++;
      throw rejected("Class B cap exceeded");
    },
  };
  for (const key of ["one", "two", "three"])
    assert.equal(
      (
        await diagnoseCloudError(
          client,
          "HeadObjectCommand",
          { Bucket: "bucket", Key: key },
          rejected(),
        )
      ).name,
      "BackblazeCapExceeded",
    );
  assert.equal(calls, 1);
});
test("ordinary missing files keep their original 404 result", async () => {
  const error = rejected("UnknownError", 404);
  assert.equal(
    await diagnoseCloudError({}, "HeadObjectCommand", { Key: "new" }, error),
    error,
  );
});
test("successful diagnostic streams are closed and unknown permission denial is explained", async () => {
  let closed = false;
  const client = {
    send: async () => ({
      Body: {
        destroy() {
          closed = true;
        },
      },
    }),
  };
  const result = await diagnoseCloudError(
    client,
    "HeadObjectCommand",
    { Bucket: "b", Key: "k" },
    rejected(),
  );
  assert.equal(closed, true);
  assert.match(result.message, /HTTP 403/);
  assert.equal(result.name, "AccessDenied");
});
test("known provider permission errors retain their original detail", async () => {
  const detail = rejected("This key cannot read this bucket");
  const result = await diagnoseCloudError(
    {
      send: async () => {
        throw detail;
      },
    },
    "HeadObjectCommand",
    { Bucket: "b", Key: "k" },
    rejected(),
  );
  assert.equal(result, detail);
});
test("download cap failures are explained without diagnosing another command", async () => {
  const result = await diagnoseCloudError(
    {},
    "GetObjectCommand",
    {},
    rejected("Download bandwidth cap exceeded"),
  );
  assert.equal(result.name, "BackblazeCapExceeded");
});
test("account caps are distinguished from server capacity errors", () => {
  assert.equal(isCloudLimit(rejected("Server capacity exceeded")), false);
  assert.equal(isCloudLimit(rejected("daily transaction cap exceeded")), true);
  assert.equal(CAPS_URL, "https://secure.backblaze.com/b2_caps.htm");
});
