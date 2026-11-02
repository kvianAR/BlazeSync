const path = require("node:path");
function validateConnection(input) {
  const endpoint = new URL(input.endpoint.trim());
  if (
    endpoint.protocol !== "https:" ||
    !/^s3\.[a-z0-9-]+\.backblazeb2\.com$/.test(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.port ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/"
  )
    throw new Error(
      "Use your B2 S3 endpoint, for example https://s3.us-west-004.backblazeb2.com",
    );
  const region = endpoint.hostname.split(".")[1];
  if (!input.keyId?.trim() || !input.applicationKey?.trim())
    throw new Error("Application Key ID and Application Key are required.");
  return {
    endpoint: endpoint.origin,
    region,
    keyId: input.keyId.trim(),
    applicationKey: input.applicationKey.trim(),
    bucket: input.bucket?.trim() || "",
  };
}
function joinKey(prefix, name) {
  return `${prefix && !prefix.endsWith("/") ? prefix + "/" : prefix}${name}`;
}
function copySource(bucket, key, version) {
  return `${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}?versionId=${encodeURIComponent(version)}`;
}
function backupKey(prefix, root, file) {
  const relative = path.relative(root, file);
  if (
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  )
    throw new Error("File is outside backup folder");
  return joinKey(prefix, relative.split(path.sep).join("/"));
}
function due(job, now = Date.now()) {
  return (
    job.enabled &&
    !job.running &&
    (!job.lastAttempt || now - job.lastAttempt >= job.interval * 60000)
  );
}
const photoExtensions = new Set(
  "jpg jpeg png gif webp avif heic heif tif tiff bmp dng cr2 cr3 nef arw raf orf rw2 pef srw".split(
    " ",
  ),
);
function isPhoto(key) {
  return photoExtensions.has(path.posix.extname(key).slice(1).toLowerCase());
}
function canPreview(key) {
  return /\.(jpe?g|png|gif|webp|avif|bmp)$/i.test(key);
}
module.exports = {
  isPhoto,
  canPreview,
  validateConnection,
  joinKey,
  copySource,
  backupKey,
  due,
};
