const { GetObjectCommand } = require("@aws-sdk/client-s3");
const CAPS_URL = "https://secure.backblaze.com/b2_caps.htm";
const knownLimits = new WeakMap();
function isCloudLimit(error) {
  return (
    error?.name === "BackblazeCapExceeded" ||
    /\bcaps?\b.{0,30}exceed|download bandwidth.*\bcap\b|transaction.*\bcap\b/i.test(
      error?.message || "",
    )
  );
}
function limitError(cause) {
  const error = new Error(
    "Backblaze account cap reached. Download bandwidth or Class B transaction limits are blocking file checks. Open Caps & Alerts to review your limits, then retry sync.",
    { cause },
  );
  error.name = "BackblazeCapExceeded";
  error.$metadata = cause.$metadata;
  return error;
}
async function diagnoseCloudError(client, command, input, error) {
  if (isCloudLimit(error)) return limitError(error);
  if (
    command !== "HeadObjectCommand" ||
    error.$metadata?.httpStatusCode !== 403 ||
    !/^(UnknownError|Unknown)?$/i.test(error.message || "") ||
    !input?.Key
  )
    return error;
  // HEAD errors have no response body. A one-byte GET can expose B2's rejection reason.
  const cached = knownLimits.get(client);
  if (cached && Date.now() - cached < 60000) return limitError(error);
  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: input.Bucket,
        Key: input.Key,
        VersionId: input.VersionId,
        Range: "bytes=0-0",
      }),
    );
    response.Body?.destroy();
  } catch (details) {
    if (isCloudLimit(details)) {
      knownLimits.set(client, Date.now());
      return limitError(details);
    }
    if (
      details.$metadata?.httpStatusCode === 403 &&
      details.message &&
      !/^(UnknownError|Unknown)$/i.test(details.message)
    )
      return details;
  }
  const explained = new Error(
    "Backblaze refused the cloud file check (HTTP 403). Review the account's Caps & Alerts and the key's readFiles permission.",
    { cause: error },
  );
  explained.name = "AccessDenied";
  explained.$metadata = error.$metadata;
  return explained;
}
module.exports = { CAPS_URL, isCloudLimit, diagnoseCloudError };
