const { setTimeout: wait } = require("node:timers/promises");
const { validateConnection } = require("./helpers.cjs");
function transient(error) {
  return (
    error?.name === "TimeoutError" ||
    error?.name === "AbortError" ||
    error instanceof TypeError ||
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "ENOTFOUND",
      "EAI_AGAIN",
      "EPIPE",
      "ENETUNREACH",
    ].includes(error?.code) ||
    error?.$metadata?.httpStatusCode === 429 ||
    error?.$metadata?.httpStatusCode >= 500
  );
}
async function discoverConnection(input, request = fetch, delay = wait) {
  const keyId = input.keyId?.trim(),
    applicationKey = input.applicationKey?.trim();
  if (!keyId || !applicationKey)
    throw new Error("Enter your Application Key ID and Application Key.");
  let result;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await request(
        "https://api.backblazeb2.com/b2api/v4/b2_authorize_account",
        {
          method: "GET",
          redirect: "error",
          headers: {
            Authorization:
              "Basic " +
              Buffer.from(keyId + ":" + applicationKey).toString("base64"),
          },
          signal: AbortSignal.timeout(20000),
        },
      );
      if (response.status === 429 || response.status >= 500) {
        const e = new Error(
          "Backblaze is temporarily unavailable. Please try again.",
        );
        e.$metadata = { httpStatusCode: response.status };
        throw e;
      }
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? "That key was rejected. Check the Application Key ID and Application Key."
            : "Backblaze could not authorize this key. Check its permissions and expiry.",
        );
      result = await response.json();
      break;
    } catch (error) {
      if (!transient(error) || attempt === 2) {
        if (transient(error))
          throw new Error(
            "Could not reach Backblaze. Check your internet connection and try again. Your saved connection has not been removed.",
          );
        throw error;
      }
      await delay(500 * 2 ** attempt);
    }
  }
  const storage = result.apiInfo?.storageApi;
  if (!storage?.s3ApiUrl)
    throw new Error(
      "Use a standard Backblaze B2 Application Key with S3 access.",
    );
  const allowed = storage.allowed || {};
  if (allowed.namePrefix)
    throw new Error(
      "This key restricts file-name prefixes. Create a dedicated key for the bucket without a file-name prefix.",
    );
  const restricted = allowed.buckets;
  let buckets = Array.isArray(restricted)
    ? restricted.map((b) => b.name).filter(Boolean)
    : [];
  if (Array.isArray(restricted) && restricted.some((b) => !b.name)) {
    if (!input.bucket?.trim())
      throw new Error(
        "BUCKET_NAME_REQUIRED: This key hides its bucket name. Enter the bucket name once to finish connecting.",
      );
    if (restricted.length !== 1)
      throw new Error(
        "This multi-bucket key hides bucket names. Enable listAllBucketNames on the key to connect all its buckets.",
      );
    buckets = [input.bucket.trim()];
  }
  const c = validateConnection({
    endpoint: storage.s3ApiUrl,
    keyId,
    applicationKey,
    bucket: buckets.length === 1 ? buckets[0] : "",
  });
  return {
    ...c,
    buckets,
    bucketScope: Array.isArray(restricted) ? "restricted" : "account",
    expiresAt: result.applicationKeyExpirationTimestamp || null,
  };
}
function healthFromError(error) {
  if (transient(error)) return "offline";
  if (
    [
      "InvalidAccessKeyId",
      "ExpiredToken",
      "InvalidToken",
      "SignatureDoesNotMatch",
    ].includes(error?.name)
  )
    return "key-error";
  return null;
}
module.exports = { discoverConnection, transient, healthFromError };
