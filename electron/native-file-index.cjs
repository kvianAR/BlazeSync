const connections = new WeakMap();

function registerNativeIndex(client, connection, request = fetch) {
  connections.set(client, { connection, request });
}
async function nativeFileIndex(client, bucket, prefix) {
  const context = connections.get(client);
  if (!context) return null;
  const { connection, request } = context;
  async function json(url, options) {
    const response = await request(url, {
      ...options, redirect: "error", signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const error = new Error("Backblaze file index request failed");
      error.$metadata = { httpStatusCode: response.status };
      throw error;
    }
    return response.json();
  }
  // Native listings include authoritative checksums and metadata for thousands of files per request.
  const auth = await json("https://api.backblazeb2.com/b2api/v4/b2_authorize_account", {
    headers: { Authorization: "Basic " + Buffer.from(connection.keyId + ":" + connection.applicationKey).toString("base64") },
  });
  const storage = auth.apiInfo?.storageApi;
  if (!storage?.apiUrl || storage.s3ApiUrl !== connection.endpoint) return null;
  async function call(method, body) {
    return json(storage.apiUrl + "/b2api/v4/" + method, {
      method: "POST",
      headers: { Authorization: auth.authorizationToken, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  let buckets = storage.allowed?.buckets;
  let match = buckets?.find((item) => item.name === bucket);
  if (!match && buckets?.length === 1 && connection.buckets?.includes(bucket))
    match = buckets[0];
  if (!match) {
    const listed = await call("b2_list_buckets", { accountId: auth.accountId, bucketName: bucket });
    match = listed.buckets?.find((item) => item.bucketName === bucket);
  }
  const bucketId = match?.id || match?.bucketId;
  if (!bucketId) return null;
  const result = new Map();
  const seen = new Set();
  let startFileName;
  do {
    const page = await call("b2_list_file_names", { bucketId, prefix, maxFileCount: 10000, startFileName });
    if (!Array.isArray(page.files)) throw new Error("Backblaze returned an incomplete file index");
    for (const file of page.files) {
      if (!file.fileName?.startsWith(prefix) || !Number.isSafeInteger(file.contentLength))
        throw new Error("Backblaze returned an invalid file index");
      result.set(file.fileName, {
        Key: file.fileName, Size: file.contentLength,
        ContentLength: file.contentLength, VersionId: file.fileId,
        Metadata: file.fileInfo || {},
        ContentSHA1: file.contentSha1 === "none" ? file.fileInfo?.large_file_sha1 : file.contentSha1,
      });
    }
    startFileName = page.nextFileName;
    if (startFileName && seen.has(startFileName)) throw new Error("Backblaze repeated a file index page");
    if (startFileName) seen.add(startFileName);
  } while (startFileName);
  return result;
}
module.exports = { registerNativeIndex, nativeFileIndex };
