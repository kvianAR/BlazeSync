const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  clipboard,
  Tray,
  Menu,
  nativeImage,
  screen,
  powerMonitor,
  shell,
  nativeTheme,
  Notification,
} = require("electron");
const fs = require("node:fs");
const fsp = fs.promises;
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectVersionsCommand,
  CopyObjectCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const { createHash } = require("node:crypto");
const { Upload } = require("@aws-sdk/lib-storage");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const {
  validateConnection,
  joinKey,
  copySource,
  backupKey,
  due,
  isPhoto,
  canPreview,
} = require("./helpers.cjs");
const { discoverConnection, healthFromError } = require("./connection.cjs");
let health = "checking",
  cloudLimit = null,
  checkingConnection = false,
  pendingSavedSecret = null;
let win,
  tray,
  trayWindow,
  isQuitting = false,
  client,
  connection,
  transfers = [],
  jobs = [],
  events = [],
  active = new Map();
const {
  uploadEntries,
  safeDownloadPath,
  updateProgress,
  deleteError,
  cancelled,
} = require("./files.cjs");
const { FolderMetrics } = require("./folder-metrics.cjs");
const folderMetrics = new FolderMetrics();
const { scanStorage } = require("./billing.cjs");
const {
  CAPS_URL,
  isCloudLimit,
  diagnoseCloudError,
} = require("./cloud-errors.cjs");
const { prepareUploadPlan } = require("./upload-plan.cjs");
const {
  hashFile,
  unchangedFile,
  syncArguments,
  folderDestination,
} = require("./folder-sync.cjs");
const { servicePath, installFinderSync } = require("./finder-sync.cjs");
const {
  BILLING_URL,
  validatePaymentDay,
  paymentReminder,
} = require("./payment-reminder.cjs");
const {
  normalizeSelection,
  selectedObjects,
  createMovePlan,
  executeMove,
  baseName,
} = require("./file-management.cjs");
let fileOperation = null,
  billingCache = null,
  billingPending = null,
  billingProgress = null;
function assertNoFileOperation() {
  if (fileOperation)
    throw new Error("Wait for the current file operation to finish.");
}
async function withFileOperation(label, run) {
  assertNoFileOperation();
  if (jobs.some((job) => job.running))
    throw new Error("Wait for the running folder backup to finish.");
  const sdk = getClient();
  fileOperation = { label, stage: "preparing", completed: 0, total: 0 };
  emit();
  try {
    return await run(sdk, (progress) => {
      fileOperation = { label, ...progress };
      emit();
    });
  } finally {
    fileOperation = null;
    emit();
  }
}

function connectionId() {
  return connection
    ? createHash("sha256")
        .update(connection.endpoint + "|" + connection.keyId)
        .digest("hex")
        .slice(0, 24)
    : null;
}
let uploadTail = Promise.resolve(),
  downloadTail = Promise.resolve(),
  revision = 0,
  connectionEditing = false;
let preferences = { theme: "dark", uploadTarget: null, refreshSeconds: 15 };
const preferencesPath = () =>
  path.join(app.getPath("userData"), "preferences.json");
function savePreferences() {
  fs.writeFileSync(preferencesPath(), JSON.stringify(preferences), {
    mode: 0o600,
  });
}
function cloudChanged() {
  folderMetrics.invalidate();
  billingCache = null;
  revision++;
  emit();
}
let progressTimer;
function progressEmit() {
  if (isQuitting) return;
  if (!progressTimer)
    progressTimer = setTimeout(() => {
      progressTimer = null;
      emit();
    }, 200);
}
function dropError(error) {
  log(error.message);
  showMain("files");
  win.webContents.send("vault:error", error.message);
}
async function dropOnTray(paths) {
  try {
    const target = preferences.uploadTarget;
    if (!client) throw new Error("Connect Backblaze B2 before dropping files.");
    if (
      !target ||
      target.endpoint !== connection.endpoint ||
      target.keyId !== connection.keyId
    )
      throw new Error(
        "Open a bucket or folder in BlazeSync first to choose the upload destination.",
      );
    await queuePaths(target.bucket, target.prefix, paths);
  } catch (error) {
    dropError(error);
  }
}

const {
  historyPage,
  exactVersions,
  purgeVersions,
} = require("./cloud-history.cjs");
const statePath = () => path.join(app.getPath("userData"), "vault.json");
function persist(savedConnection = connection) {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("macOS protected credential storage is unavailable.");
  const preservePending = arguments.length === 0 ? pendingSavedSecret : null;
  const temporary = statePath() + ".tmp";
  fs.writeFileSync(
    temporary,
    JSON.stringify({
      secret: savedConnection
        ? safeStorage
            .encryptString(JSON.stringify(savedConnection))
            .toString("base64")
        : preservePending || null,
      jobs: jobs.map(({ running, ...j }) => j),
    }),
    { mode: 0o600 },
  );
  fs.renameSync(temporary, statePath());
}
function checkPaymentReminder() {
  if (smoke || isQuitting || !Notification.isSupported()) return;
  const reminder = paymentReminder(
    preferences.billingPaymentDay || 0,
    new Date(),
    preferences.lastPaymentNotification,
  );
  if (!reminder?.ready) return;
  const notification = new Notification({
    title: "BlazeSync · Backblaze payment reminder",
    body:
      reminder.daysRemaining === 0
        ? "Your chosen monthly payment date is today. Open Backblaze billing to review your balance."
        : `Your chosen monthly payment date is in ${reminder.daysRemaining} day${reminder.daysRemaining === 1 ? "" : "s"}. Open Backblaze billing to review your balance.`,
  });
  notification.on("click", () => shell.openExternal(BILLING_URL));
  notification.on("failed", () => {
    if (preferences.lastPaymentNotification === reminder.notificationKey) {
      preferences.lastPaymentNotification = null;
      savePreferences();
    }
  });
  preferences.lastPaymentNotification = reminder.notificationKey;
  savePreferences();
  try {
    notification.show();
  } catch {
    preferences.lastPaymentNotification = null;
    savePreferences();
  }
}
function publicState() {
  return {
    connected: !!client,
    fileOperation,
    billingProgress,
    billingBudgetUsd: preferences.billingBudgetUsd || 0,
    finderSyncInstalled: fs.existsSync(servicePath(app.getPath("home"))),
    billingPaymentDay: preferences.billingPaymentDay || 0,
    paymentReminder: paymentReminder(preferences.billingPaymentDay || 0),
    notificationsSupported: Notification.isSupported(),
    connectionId: connectionId(),
    health,
    cloudLimit,
    revision,
    refreshSeconds: preferences.refreshSeconds ?? 15,
    connectionEditing,
    theme: preferences.theme,
    dark:
      preferences.theme === "dark" ||
      (preferences.theme === "system" && nativeTheme.shouldUseDarkColors),
    uploadTarget:
      preferences.uploadTarget &&
      connection &&
      preferences.uploadTarget.endpoint === connection.endpoint &&
      preferences.uploadTarget.keyId === connection.keyId
        ? {
            bucket: preferences.uploadTarget.bucket,
            prefix: preferences.uploadTarget.prefix,
          }
        : null,
    connection: connection
      ? {
          endpoint: connection.endpoint,
          region: connection.region,
          bucket: connection.bucket,
          buckets: connection.buckets || [],
          keyId: connection.keyId.slice(0, 5) + "••••",
        }
      : null,
    transfers,
    jobs: jobs.map(({ keyId, endpoint, ...job }) => job),
    events,
  };
}
function emit() {
  if (isQuitting) return;
  for (const w of [win, trayWindow])
    if (w && !w.isDestroyed())
      w.webContents.send("vault:update", publicState());
  if (tray && !tray.isDestroyed())
    tray.setToolTip(
      "BlazeSync · " +
        transfers.filter((t) => ["queued", "running"].includes(t.status))
          .length +
        " active transfers",
    );
}
function log(message) {
  events.unshift({ id: crypto.randomUUID(), at: Date.now(), message });
  events = events.slice(0, 100);
  emit();
}
function getClient() {
  if (!client) throw new Error("Connect your Backblaze B2 account first.");
  return client;
}
function setHealth(next) {
  if (health !== next) {
    health = next;
    emit();
  }
}
function makeClient(c) {
  const sdk = new S3Client({
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 10000,
      socketTimeout: 60000,
    }),
    endpoint: c.endpoint,
    region: c.region,
    credentials: { accessKeyId: c.keyId, secretAccessKey: c.applicationKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    retryMode: "standard",
    maxAttempts: 5,
  });
  return configureCloudClient(sdk);
}
function configureCloudClient(sdk) {
  sdk.middlewareStack.add(
    (next, context) => async (args) => {
      try {
        const result = await next(args);
        if (client === sdk) {
          if (
            cloudLimit &&
            [200, 206].includes(result.response?.statusCode) &&
            ["HeadObjectCommand", "GetObjectCommand"].includes(
              context.commandName,
            )
          ) {
            cloudLimit = null;
            emit();
          }
          setHealth("online");
        }
        return result;
      } catch (original) {
        const error = await diagnoseCloudError(
          sdk,
          context.commandName,
          args.input,
          original,
        );
        if (client === sdk) {
          if (isCloudLimit(error)) {
            cloudLimit = error.message;
            emit();
          }
          const status = healthFromError(error);
          if (status) setHealth(status);
        }
        throw error;
      }
    },
    { step: "initialize", name: "blazeConnectionHealth", override: true },
  );
  return sdk;
}
async function connectionBuckets(c = connection, s3 = client) {
  if (c.buckets?.length) return c.buckets.map((Name) => ({ Name }));
  if (c.bucket) return [{ Name: c.bucket }];
  return (await s3.send(new ListBucketsCommand({}))).Buckets || [];
}
function restoreSavedConnection() {
  if (!pendingSavedSecret || client) return;
  try {
    const restored = JSON.parse(
      safeStorage.decryptString(Buffer.from(pendingSavedSecret, "base64")),
    );
    validateConnection(restored);
    connection = restored;
    client = makeClient(restored);
    pendingSavedSecret = null;
    setHealth("checking");
  } catch {
    setHealth("locked");
  }
}
async function checkConnection() {
  restoreSavedConnection();
  if (!client || checkingConnection) return;
  checkingConnection = true;
  const current = client;
  try {
    const buckets = await connectionBuckets();
    if (buckets[0])
      await current.send(
        new ListObjectsV2Command({ Bucket: buckets[0].Name, MaxKeys: 1 }),
      );
    if (client === current) setHealth("online");
  } catch (error) {
    if (client === current) setHealth(healthFromError(error) || "attention");
  } finally {
    checkingConnection = false;
  }
}
function transfer(type, bucket, key, size = 0) {
  const t = {
    id: crypto.randomUUID(),
    type,
    bucket,
    key,
    size,
    loaded: 0,
    status: "queued",
    at: Date.now(),
  };
  transfers.unshift(t);
  if (transfers.length > 300)
    transfers = transfers
      .filter((x) => !["done", "failed", "cancelled"].includes(x.status))
      .concat(
        transfers
          .filter((x) => ["done", "failed", "cancelled"].includes(x.status))
          .slice(0, 200),
      );
  emit();
  return t;
}
function fail(t, e) {
  t.status =
    e.name === "AbortError" || t.status === "cancelled"
      ? "cancelled"
      : "failed";
  t.speed = 0;
  t.eta = null;
  t.error = t.status === "failed" ? e.message : undefined;
  emit();
}
async function uploadFile(bucket, key, file, directory = false, size = 0) {
  const t = transfer("upload", bucket, key, size);
  t.directory = directory;
  const result = uploadTail.then(async () => {
    let uploader;
    try {
      if (t.status === "cancelled") throw cancelled();
      const c = getClient(),
        stat = directory ? { size: 0, mtimeMs: 0 } : await fsp.stat(file);
      t.size = stat.size;
      t.status = "running";
      t.startedAt = Date.now();
      emit();
      if (directory) {
        const abort = new AbortController();
        active.set(t.id, () => abort.abort());
        await c.send(
          new PutObjectCommand({ Bucket: bucket, Key: key, Body: "" }),
          { abortSignal: abort.signal },
        );
      } else {
        const hashing = new AbortController();
        active.set(t.id, () => hashing.abort());
        const contentHash = await hashFile(file, hashing.signal);
        if (t.status === "cancelled") throw cancelled();
        uploader = new Upload({
          client: c,
          params: {
            Bucket: bucket,
            Key: key,
            Body: fs.createReadStream(file),
            ContentLength: stat.size,
            Metadata: {
              "vault-mtime": String(Math.trunc(stat.mtimeMs)),
              "blazesync-sha256": contentHash,
            },
          },
          queueSize: 3,
          partSize: 8 * 1024 * 1024,
          leavePartsOnError: false,
        });
        active.set(t.id, () => uploader.abort());
        uploader.on("httpUploadProgress", (p) => {
          updateProgress(t, p.loaded || 0);
          progressEmit();
        });
        await uploader.done();
        const head = await c.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        );
        if (head.ContentLength !== stat.size)
          throw new Error("Upload size verification failed");
        const after = await fsp.stat(file);
        if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
          throw new Error(
            "Local file changed during upload. Retry after the file stops changing.",
          );
      }
      if (t.status === "cancelled") throw cancelled();
      t.status = "done";
      t.loaded = t.size;
      t.speed = 0;
      t.eta = 0;
      cloudChanged();
    } catch (error) {
      fail(t, error);
      throw error;
    } finally {
      active.delete(t.id);
    }
  });
  uploadTail = result.catch(() => {});
  return result;
}
async function availableCopyKey(bucket, key) {
  const extension = path.posix.extname(key);
  const stem = extension ? key.slice(0, -extension.length) : key;
  const copy =
    stem + " (copy " + crypto.randomUUID().slice(0, 8) + ")" + extension;
  try {
    await getClient().send(
      new HeadObjectCommand({ Bucket: bucket, Key: copy }),
    );
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404 || error.name === "NotFound")
      return copy;
    throw error;
  }
  throw new Error("Copy name already exists. Try again.");
}
async function queuePaths(bucket, prefix, paths) {
  if (!bucket) throw new Error("Select an upload bucket first.");
  return withFileOperation(
    "Checking upload destination",
    async (sdk, progress) => {
      const entries = [];
      for (const localPath of paths) {
        if (typeof localPath !== "string" || !path.isAbsolute(localPath))
          throw new Error("Choose a local file or folder.");
        const stat = await fsp.lstat(localPath);
        const destination = stat.isDirectory()
          ? folderDestination(prefix, localPath)
          : null;
        const targetPrefix = destination
          ? destination.slice(0, -path.basename(localPath).length - 1)
          : prefix;
        for await (const entry of uploadEntries([localPath], targetPrefix))
          entries.push(entry);
      }
      const conflicts = new Set(),
        selectedNames = new Set();
      let checked = 0,
        keepBoth = false;
      for (const entry of entries) {
        blockBusyDelete(bucket, entry.key);
        let head;
        try {
          head = await sdk.send(
            new HeadObjectCommand({ Bucket: bucket, Key: entry.key }),
          );
        } catch (error) {
          if (
            error.$metadata?.httpStatusCode !== 404 &&
            error.name !== "NotFound"
          )
            throw error;
        }
        const same = entry.directory
          ? !!head
          : head &&
            (await unchangedFile(sdk, bucket, entry.key, entry.file, head));
        entry.existing = !!head;
        entry.unchanged = !!same;
        if (!entry.directory && (head || selectedNames.has(entry.key)))
          conflicts.add(entry.key);
        selectedNames.add(entry.key);
        progress({
          stage: "checking",
          completed: ++checked,
          total: entries.length,
        });
      }
      if (conflicts.size) {
        showMain();
        const answer = await dialog.showMessageBox(win, {
          type: "warning",
          message: "Files with these names already exist",
          detail:
            [...conflicts].slice(0, 20).join("\n") +
            "\n" +
            conflicts.size +
            " repeated destination name(s). Merge updates skips unchanged content and updates changed files. For multiple selected sources with the same destination, the last selected source wins. Keep both preserves separate copies. Older cloud versions may remain stored and billed.",
          buttons: ["Cancel", "Merge updates", "Keep both"],
          cancelId: 0,
          defaultId: 0,
        });
        if (answer.response === 0) return false;
        keepBoth = answer.response === 2;
      }
      const { pending, skipped, merged } = await prepareUploadPlan(
        entries,
        keepBoth,
        (key) => availableCopyKey(bucket, key),
      );
      for (const entry of pending)
        uploadFile(
          bucket,
          entry.key,
          entry.file,
          entry.directory,
          entry.size,
        ).catch(() => {});
      const count = pending.filter((entry) => !entry.directory).length;
      log("Queued " + count + " file(s) for " + bucket + "/" + prefix);
      log("Skipped " + skipped + " unchanged item(s)");
      if (merged)
        log(
          "Merged " +
            merged +
            " repeated input path(s), using the last selected source.",
        );
      return { files: count, skipped, merged };
    },
  );
}
async function downloadToFile(bucket, key, destination, group = "") {
  const c = getClient(),
    t = transfer("download", bucket, key);
  t.group = group;
  const result = downloadTail.then(async () => {
    const abort = new AbortController();
    const temporary = destination + ".vault-" + t.id + ".part";
    try {
      if (t.status === "cancelled") throw cancelled();
      active.set(t.id, () => abort.abort());
      t.status = "running";
      t.startedAt = Date.now();
      emit();
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      const object = await c.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { abortSignal: abort.signal },
      );
      t.size = object.ContentLength || 0;
      object.Body.on("data", (chunk) => {
        updateProgress(t, t.loaded + chunk.length);
        progressEmit();
      });
      await pipeline(
        object.Body,
        fs.createWriteStream(temporary, { flags: "wx" }),
        { signal: abort.signal },
      );
      if (t.loaded !== t.size)
        throw new Error("Download size verification failed");
      if (group) {
        await fsp.copyFile(temporary, destination, fs.constants.COPYFILE_EXCL);
        await fsp.rm(temporary);
      } else await fsp.rename(temporary, destination);
      t.status = "done";
      t.speed = 0;
      t.eta = 0;
      emit();
    } catch (error) {
      await fsp.rm(temporary, { force: true }).catch(() => {});
      fail(t, error);
      throw error;
    } finally {
      active.delete(t.id);
    }
  });
  downloadTail = result.catch(() => {});
  return result;
}
async function listTree(bucket, prefix) {
  const objects = [];
  let token;
  const seenTokens = new Set();
  do {
    const result = await getClient().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 1000,
        ContinuationToken: token,
      }),
    );
    objects.push(...(result.Contents || []));
    token = result.NextContinuationToken;
    if (result.IsTruncated && !token)
      throw new Error(
        "Cloud folder listing is incomplete. Refresh and try again.",
      );
    if (token) {
      if (seenTokens.has(token))
        throw new Error("Backblaze repeated a folder page.");
      seenTokens.add(token);
    }
  } while (token);
  return objects;
}
function blockBusyDelete(bucket, prefix, folder = false) {
  if (
    transfers.some(
      (t) =>
        t.type === "upload" &&
        t.bucket === bucket &&
        ["queued", "running"].includes(t.status) &&
        (folder ? t.key.startsWith(prefix) : t.key === prefix),
    )
  )
    throw new Error(
      "An upload is still writing here. Finish or cancel it before deleting.",
    );
}
async function deleteKey(bucket, key) {
  try {
    await getClient().send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key }),
    );
  } catch (error) {
    throw deleteError(error);
  }
}
async function* walk(root) {
  for (const e of await fsp.readdir(root, { withFileTypes: true })) {
    if (e.name === ".DS_Store") continue;
    const p = path.join(root, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}
async function* jobEntries(job) {
  if (job.kind === "sync") {
    for await (const entry of uploadEntries([job.folder])) {
      const relative = entry.key
        .slice(path.basename(job.folder).length)
        .replace(/^\//, "");
      const sourceKey = job.prefix + relative;
      yield { ...entry, sourceKey, key: job.targets?.[sourceKey] || sourceKey };
    }
  } else {
    for await (const file of walk(job.folder)) {
      const sourceKey = backupKey(job.prefix, job.folder, file);
      yield { file, sourceKey, key: job.targets?.[sourceKey] || sourceKey };
    }
  }
}
async function registerSync(bucket, prefix, folder) {
  return withFileOperation("Preparing folder sync", async () => {
    getClient();
    if (typeof folder !== "string" || !path.isAbsolute(folder))
      throw new Error("Choose an absolute local folder.");
    const stat = await fsp.lstat(folder);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Choose a local folder, without a symbolic link.");
    folder = path.resolve(folder);
    const destination = folderDestination(prefix, folder);
    const existing = jobs.find(
      (job) =>
        job.kind === "sync" &&
        job.folder === folder &&
        job.bucket === bucket &&
        job.prefix === destination &&
        job.endpoint === connection.endpoint &&
        job.keyId === connection.keyId,
    );
    if (existing) return existing;
    const answer = await dialog.showMessageBox(win, {
      type: "question",
      message: "Sync this folder with Backblaze?",
      detail:
        folder +
        "\nDestination: " +
        bucket +
        "/" +
        destination +
        "\nNew and changed local files will upload every 5 minutes while BlazeSync runs. Existing cloud files with the same names get updated versions.",
      buttons: ["Cancel", "Enable folder sync"],
      defaultId: 0,
      cancelId: 0,
    });
    if (answer.response !== 1) return null;
    const job = {
      id: crypto.randomUUID(),
      kind: "sync",
      name: path.basename(folder),
      folder,
      bucket,
      prefix: destination,
      interval: 5,
      enabled: true,
      endpoint: connection.endpoint,
      keyId: connection.keyId,
    };
    jobs.push(job);
    persist();
    emit();
    return job;
  });
}
async function syncFinderPaths(paths) {
  showMain("backups");
  getClient();
  if (!paths.length) return;
  for (const folder of paths) {
    const existing = jobs.filter(
      (job) =>
        job.kind === "sync" &&
        job.folder === folder &&
        job.endpoint === connection.endpoint &&
        job.keyId === connection.keyId,
    );
    if (existing.length > 1)
      throw new Error(
        "This folder has several sync destinations. Choose Sync now inside BlazeSync.",
      );
    let job = existing[0];
    if (!job) {
      const target = preferences.uploadTarget;
      if (
        !target ||
        target.endpoint !== connection.endpoint ||
        target.keyId !== connection.keyId
      )
        throw new Error(
          "Choose the destination bucket and folder in BlazeSync first, then use Finder sync.",
        );
      job = await registerSync(target.bucket, target.prefix, folder);
    }
    if (job) await runBackup(job.id, true);
  }
}
async function runBackup(id, interactive = false) {
  assertNoFileOperation();
  const j = jobs.find((j) => j.id === id);
  if (!j || j.running) return;
  if (!client) throw new Error("Connect your B2 account first.");
  if (j.endpoint !== connection.endpoint || j.keyId !== connection.keyId)
    throw new Error(
      "This backup belongs to another connection. Reconnect its original B2 key.",
    );
  if (jobs.some((job) => job.running))
    throw new Error("Wait for the current folder sync to finish.");
  j.running = true;
  j.lastAttempt = Date.now();
  j.error = null;
  let count = 0,
    skipped = 0;
  try {
    const source = await fsp.lstat(j.folder);
    if (!source.isDirectory() || source.isSymbolicLink())
      throw new Error(
        "The linked local folder was replaced. Choose the folder again before syncing.",
      );
    persist();
    emit();
    const entries = [];
    for await (const entry of jobEntries(j)) {
      if (!j.running) throw cancelled();
      blockBusyDelete(j.bucket, entry.key);
      let head;
      try {
        head = await getClient().send(
          new HeadObjectCommand({ Bucket: j.bucket, Key: entry.key }),
        );
      } catch (error) {
        if (
          error.$metadata?.httpStatusCode !== 404 &&
          error.name !== "NotFound"
        )
          throw error;
      }
      const same = entry.directory
        ? !!head
        : head &&
          (await unchangedFile(
            getClient(),
            j.bucket,
            entry.key,
            entry.file,
            head,
          ));
      entries.push({ ...entry, existing: !!head, same });
    }
    let keepBoth = false;
    const existing = entries.filter(
      (entry) => !entry.directory && entry.existing,
    );
    if (interactive && existing.length) {
      showMain("backups");
      const answer = await dialog.showMessageBox(win, {
        type: "question",
        message: "How should existing files sync?",
        detail:
          existing.length +
          " existing file(s). Merge updates uploads changed content and skips unchanged files. Keep both makes separate copies and uses those copies for future syncs.",
        buttons: ["Cancel", "Merge updates", "Keep both"],
        defaultId: 1,
        cancelId: 0,
      });
      if (answer.response === 0) throw cancelled();
      keepBoth = answer.response === 2;
    }
    for (const entry of entries) {
      if (!j.running) throw cancelled();
      const duplicate = keepBoth && entry.existing && !entry.directory;
      if (entry.same && !duplicate) {
        skipped++;
        continue;
      }
      const key = duplicate
        ? await availableCopyKey(j.bucket, entry.key)
        : entry.key;
      if (duplicate) {
        j.targets = { ...j.targets, [entry.sourceKey]: key };
        persist();
      }
      await uploadFile(j.bucket, key, entry.file, entry.directory, entry.size);
      count++;
    }
    if (!j.running) throw cancelled();
    j.lastSuccess = Date.now();
    j.lastUploaded = count;
    j.lastSkipped = skipped;
    log(`Backup finished: ${j.name} · ${count} uploaded, ${skipped} unchanged`);
  } catch (e) {
    j.error = e.message;
    log(`Backup failed: ${j.name} · ${e.message}`);
  } finally {
    j.running = false;
    try {
      persist();
    } catch (error) {
      j.error = "Could not save backup state: " + error.message;
    }
    emit();
  }
}
function showMain(page) {
  if (process.platform === "darwin") app.focus({ steal: true });
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  trayWindow?.hide();
  if (page) win.webContents.send("vault:navigate", page);
}
function togglePanel() {
  if (trayWindow.isVisible()) {
    trayWindow.hide();
    return;
  }
  const anchor = tray.getBounds(),
    display = screen.getDisplayNearestPoint({
      x: anchor.x,
      y: anchor.y,
    }).workArea;
  const x = Math.max(
    display.x,
    Math.min(
      anchor.x + anchor.width / 2 - 200,
      display.x + display.width - 400,
    ),
  );
  trayWindow.setPosition(
    Math.round(x),
    Math.max(display.y, anchor.y + anchor.height + 8),
  );
  trayWindow.show();
  trayWindow.focus();
}
function createTray() {
  const icon = nativeImage
    .createFromPath(path.join(__dirname, "../assets/BlazeSyncTrayTemplate.png"))
    .resize({ width: 18, height: 18 });
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("BlazeSync");
  trayWindow = new BrowserWindow({
    width: 400,
    height: 570,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#181d28",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  trayWindow.loadFile(path.join(__dirname, "../dist/tray.html"));
  trayWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  trayWindow.webContents.on("will-navigate", (e) => e.preventDefault());
  trayWindow.on("blur", () => {
    if (!smoke) trayWindow.hide();
  });
  tray.on("click", togglePanel);
  tray.on("drop-files", (_, paths) => dropOnTray(paths));
  tray.on("right-click", () =>
    tray.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: "Open BlazeSync", click: () => showMain("files") },
        { label: "Files", click: () => showMain("library") },
        { label: "Photos", click: () => showMain("photos") },
        { label: "Folder backups", click: () => showMain("backups") },
        { label: "Transfers", click: () => showMain("transfers") },
        { label: "Connection settings", click: () => showMain("settings") },
        { type: "separator" },
        { label: "Quit BlazeSync", click: () => app.quit() },
      ]),
    ),
  );
}
const handlers = {
  setBillingBudget: (_, value) => {
    if (!Number.isFinite(value) || value < 0 || value > 10000000)
      throw new Error("Enter a valid monthly budget in USD.");
    preferences.billingBudgetUsd = value;
    savePreferences();
    emit();
  },
  setBillingPaymentDay: (_, day) => {
    preferences.billingPaymentDay = validatePaymentDay(day);
    savePreferences();
    checkPaymentReminder();
    emit();
  },
  openBilling: () => shell.openExternal(BILLING_URL),
  openCaps: () => shell.openExternal(CAPS_URL),
  openPricing: () =>
    shell.openExternal("https://www.backblaze.com/cloud-storage/pricing"),
  openBackblaze: () =>
    shell.openExternal("https://secure.backblaze.com/b2_buckets.htm"),
  billing: async (_, force = false) => {
    getClient();
    const identity = connectionId(),
      scanRevision = revision;
    if (
      !force &&
      billingCache?.identity === identity &&
      billingCache.revision === scanRevision &&
      Date.now() - billingCache.value.checkedAt < 300000
    )
      return billingCache.value;
    if (billingPending?.identity === identity) return billingPending.promise;
    const pending = { identity };
    pending.promise = (async () => {
      if (!connection.bucketScope) {
        const discovered = await discoverConnection(connection);
        if (connectionId() !== identity)
          throw new Error("Connection changed during billing scan.");
        connection = { ...connection, ...discovered };
        persist();
        emit();
      }
      const sdk = getClient();
      const buckets = await connectionBuckets();
      if (connectionId() !== identity)
        throw new Error("Connection changed during billing scan.");
      billingProgress = { completed: 0, total: buckets.length };
      emit();
      try {
        const value = await scanStorage(
          sdk,
          buckets.map((bucket) => bucket.Name),
          connection.bucketScope,
          (progress) => {
            if (connectionId() === identity) {
              billingProgress = progress;
              emit();
            }
          },
        );
        if (connectionId() !== identity)
          throw new Error("Connection changed during billing scan.");
        value.stale = revision !== scanRevision;
        if (connectionId() === identity && !value.stale)
          billingCache = { identity, revision: scanRevision, value };
        return value;
      } finally {
        if (billingPending === pending) {
          billingProgress = null;
          emit();
        }
      }
    })().finally(() => {
      if (billingPending === pending) billingPending = null;
    });
    billingPending = pending;
    return pending.promise;
  },
  moveSelection: async (
    _,
    bucket,
    entries,
    destinationBucket,
    destination,
    newName,
  ) =>
    withFileOperation(
      newName == null ? "Moving cloud items" : "Renaming cloud item",
      async (sdk, progress) => {
        const selection = normalizeSelection(entries);
        for (const entry of selection)
          blockBusyDelete(bucket, entry.key, entry.folder);
        const plan = await createMovePlan(
          sdk,
          bucket,
          selection,
          destinationBucket,
          destination,
          newName,
        );
        for (const item of plan.objects)
          blockBusyDelete(destinationBucket, item.target);
        const label =
          newName == null ? "Move selected items?" : "Rename selected item?";
        const detail =
          plan.selection
            .map(
              (entry) =>
                entry.key + " → " + destinationBucket + "/" + entry.target,
            )
            .slice(0, 15)
            .join("\n") +
          "\n" +
          plan.objects.length +
          " current object(s)." +
          (plan.conflicts.length
            ? "\n" +
              plan.conflicts.length +
              " existing destination file(s) will be replaced."
            : "") +
          "\nSources are removed after copies are verified. Retained versions may continue using storage.";
        const answer = await dialog.showMessageBox(win, {
          type: plan.conflicts.length ? "warning" : "question",
          message: label,
          detail,
          buttons: [
            "Cancel",
            plan.conflicts.length ? "Replace and move" : "Confirm",
          ],
          cancelId: 0,
          defaultId: 0,
        });
        if (answer.response !== 1) return false;
        try {
          const result = await executeMove(sdk, plan, true, progress);
          log("Cloud items " + (newName == null ? "moved" : "renamed"));
          return result;
        } finally {
          cloudChanged();
        }
      },
    ),
  downloadSelection: async (_, bucket, entries) =>
    withFileOperation("Preparing bulk download", async (sdk) => {
      const selection = normalizeSelection(entries);
      const chosen = await dialog.showOpenDialog(win, {
        title: "Download selected files and folders",
        properties: ["openDirectory", "createDirectory"],
      });
      if (chosen.canceled) return false;
      const objects = await selectedObjects(sdk, bucket, selection);
      const root = path.join(
        chosen.filePaths[0],
        "BlazeSync-download-" +
          Date.now() +
          "-" +
          crypto.randomUUID().slice(0, 5),
      );
      const parent =
        selection.length === 1
          ? selection[0].key
              .replace(/\/$/, "")
              .split("/")
              .slice(0, -1)
              .join("/") + "/"
          : "";
      const prefix = parent === "/" ? "" : parent;
      const destinations = objects.map((object) => ({
        object,
        destination: safeDownloadPath(root, object.key.slice(prefix.length)),
      }));
      const files = destinations.filter(
        (item) => !item.object.key.endsWith("/"),
      );
      for (const file of files) {
        if (
          destinations.some(
            (item) =>
              item !== file &&
              item.destination.startsWith(file.destination + path.sep),
          )
        )
          throw new Error(
            "A selected file conflicts with a folder of the same name. Download them separately.",
          );
      }
      await fsp.mkdir(root, { recursive: false });
      for (const item of destinations.filter((item) =>
        item.object.key.endsWith("/"),
      ))
        await fsp.mkdir(item.destination, { recursive: true });
      const results = files.map((item) =>
        downloadToFile(bucket, item.object.key, item.destination, root),
      );
      Promise.allSettled(results).then((values) => {
        const failed = values.filter(
          (value) => value.status === "rejected",
        ).length;
        log(
          "Bulk download finished: " +
            files.length +
            " files, " +
            failed +
            " failed/cancelled.",
        );
      });
      return { files: files.length, destination: root };
    }),
  removeSelection: async (_, bucket, entries) =>
    withFileOperation(
      "Deleting selected current objects",
      async (sdk, progress) => {
        const selection = normalizeSelection(entries);
        for (const entry of selection)
          blockBusyDelete(bucket, entry.key, entry.folder);
        const objects = await selectedObjects(sdk, bucket, selection);
        const answer = await dialog.showMessageBox(win, {
          type: "warning",
          message: "Delete selected current files and folders?",
          detail:
            selection
              .map((entry) => entry.key)
              .slice(0, 20)
              .join("\n") +
            "\n" +
            objects.length +
            " current object(s). Stored older versions remain subject to Backblaze retention and billing.",
          buttons: ["Cancel", "Delete selected"],
          cancelId: 0,
          defaultId: 0,
        });
        if (answer.response !== 1) return false;
        let deleted = 0;
        try {
          for (const item of objects) {
            await sdk.send(
              new DeleteObjectCommand({ Bucket: bucket, Key: item.key }),
            );
            deleted++;
            progress({
              stage: "deleting",
              completed: deleted,
              total: objects.length,
            });
          }
          for (const entry of selection) {
            const remaining = await sdk.send(
              new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: entry.key,
                MaxKeys: 1,
              }),
            );
            if (
              remaining.Contents?.some(
                (item) => entry.folder || item.Key === entry.key,
              )
            )
              throw new Error(
                "Some selected source objects remain. Refresh and check the results.",
              );
          }
          log("Deleted " + deleted + " selected current object(s)");
          return { deleted };
        } catch (error) {
          throw new Error(
            deleted +
              " object(s) deleted before the error. " +
              deleteError(error).message,
          );
        } finally {
          cloudChanged();
        }
      },
    ),

  folderStats: (_, bucket, prefix = "", force = false) =>
    folderMetrics.read(getClient(), bucket, prefix, force),
  setRefresh: (_, seconds) => {
    if (![15, 30, 60, 0].includes(seconds))
      throw new Error("Choose a supported refresh interval");
    preferences.refreshSeconds = seconds;
    savePreferences();
    emit();
  },
  history: (_, bucket, prefix = "", marker) =>
    historyPage(getClient(), bucket, prefix, marker),
  purgeFile: async (_, bucket, key) => {
    assertNoFileOperation();
    const identity = connectionId();
    blockBusyDelete(bucket, key);
    const entries = await exactVersions(getClient(), bucket, key);
    if (!entries.length) {
      cloudChanged();
      return { deleted: 0 };
    }
    const answer = await dialog.showMessageBox(win, {
      type: "warning",
      message: "Permanently delete all versions?",
      detail:
        key +
        "\n" +
        entries.length +
        " stored version(s) and delete marker(s). This removes them from Backblaze, cannot be undone and cannot bypass retention or legal holds.",
      buttons: ["Cancel", "Permanently delete"],
      cancelId: 0,
      defaultId: 0,
    });
    if (answer.response !== 1) return false;
    return withFileOperation("Deleting stored versions", async () => {
      if (connectionId() !== identity)
        throw new Error("Connection changed. Review this operation again.");
      blockBusyDelete(bucket, key);
      try {
        const deleted = await purgeVersions(getClient(), bucket, key, entries);
        cloudChanged();
        log("Permanently deleted all versions: " + key);
        return { deleted };
      } catch (error) {
        cloudChanged();
        throw deleteError(error);
      }
    });
  },

  setTheme: (_, theme) => {
    if (!["dark", "light", "system"].includes(theme))
      throw new Error("Unknown theme");
    preferences.theme = theme;
    nativeTheme.themeSource = theme;
    savePreferences();
    emit();
  },
  setUploadTarget: (_, bucket, prefix = "") => {
    getClient();
    if (!bucket) return;
    preferences.uploadTarget = {
      bucket,
      prefix,
      endpoint: connection.endpoint,
      keyId: connection.keyId,
    };
    savePreferences();
    emit();
  },
  uploadPaths: (_, bucket, prefix, paths) => queuePaths(bucket, prefix, paths),
  editConnection: async () => {
    const result = await dialog.showMessageBox(win, {
      type: "question",
      message: "Change the saved connection?",
      detail:
        "Your current connection stays active until replacement credentials are verified.",
      buttons: ["Cancel", "Change connection"],
      defaultId: 0,
      cancelId: 0,
    });
    if (result.response === 1) {
      connectionEditing = true;
      emit();
      return true;
    }
    return false;
  },
  cancelConnectionEdit: () => {
    connectionEditing = false;
    emit();
  },

  openKeys: () =>
    shell.openExternal("https://secure.backblaze.com/app_keys.htm"),
  openPage: (_, page) => {
    if (
      ![
        "files",
        "library",
        "photos",
        "backups",
        "transfers",
        "activity",
        "settings",
        "billing",
      ].includes(page)
    )
      throw new Error("Unknown page");
    showMain(page);
  },
  quit: () => app.quit(),
  catalog: async (_, bucket, token) => {
    const r = await getClient().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        MaxKeys: 1000,
        ContinuationToken: token || undefined,
      }),
    );
    return {
      files: (r.Contents || [])
        .filter((f) => !f.Key.endsWith("/"))
        .map((f) => ({
          key: f.Key,
          size: f.Size,
          modified: f.LastModified?.toISOString(),
          photo: isPhoto(f.Key),
          preview: canPreview(f.Key),
        })),
      next: r.NextContinuationToken,
    };
  },
  preview: async (_, bucket, key) => {
    if (!canPreview(key))
      throw new Error(
        "This image format needs an external viewer. Download the original to view it.",
      );
    return getSignedUrl(
      getClient(),
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: 900 },
    );
  },
  state: () => publicState(),
  connect: async (_, input) => {
    assertNoFileOperation();
    if (client && !connectionEditing)
      throw new Error(
        "Saved credentials are locked. Choose Change connection first.",
      );
    if (
      active.size ||
      jobs.some((j) => j.running) ||
      transfers.some((t) => t.status === "queued")
    )
      throw new Error("Wait for active transfers and backups to finish.");
    const c = await discoverConnection(input),
      next = makeClient(c);
    const buckets = await connectionBuckets(c, next);
    if (buckets[0])
      await next.send(
        new ListObjectsV2Command({ Bucket: buckets[0].Name, MaxKeys: 1 }),
      );
    assertNoFileOperation();
    if (
      active.size ||
      jobs.some((job) => job.running) ||
      transfers.some((transfer) => transfer.status === "queued")
    )
      throw new Error("Wait for active transfers and backups to finish.");
    persist(c);
    connectionEditing = false;
    folderMetrics.invalidate();
    connection = c;
    pendingSavedSecret = null;
    client = next;
    health = "online";
    cloudLimit = null;
    log("Connected to Backblaze B2");
    return { state: publicState(), buckets };
  },
  disconnect: async () => {
    assertNoFileOperation();
    if (
      active.size ||
      jobs.some((j) => j.running) ||
      transfers.some((t) => t.status === "queued")
    )
      throw new Error("Finish or cancel transfers before disconnecting.");
    const answer = await dialog.showMessageBox(win, {
      type: "question",
      message: "Disconnect this Mac?",
      detail: "This removes the saved key. Cloud files stay unchanged.",
      buttons: ["Cancel", "Disconnect"],
      cancelId: 0,
      defaultId: 0,
    });
    if (answer.response !== 1) return false;
    assertNoFileOperation();
    if (
      active.size ||
      jobs.some((job) => job.running) ||
      transfers.some((transfer) => transfer.status === "queued")
    )
      throw new Error("Finish or cancel transfers before disconnecting.");
    connectionEditing = false;
    persist(null);
    pendingSavedSecret = null;
    client = null;
    connection = null;
    cloudLimit = null;
    health = "checking";
    jobs = jobs.map((j) => ({ ...j, enabled: false }));
    persist();
    emit();
  },
  list: async (_, bucket, prefix = "", token) => {
    const c = getClient();
    if (!bucket)
      return {
        buckets: await connectionBuckets(),
      };
    const r = await c.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        Delimiter: "/",
        MaxKeys: 1000,
        ContinuationToken: token || undefined,
      }),
    );
    return {
      folders: (r.CommonPrefixes || []).map((p) => p.Prefix),
      files: (r.Contents || [])
        .filter((f) => f.Key !== prefix)
        .map((f) => ({
          key: f.Key,
          size: f.Size,
          modified: f.LastModified?.toISOString(),
        })),
      next: r.NextContinuationToken,
    };
  },
  upload: async (_, bucket, prefix) => {
    getClient();
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile", "openDirectory", "multiSelections"],
    });
    if (!result.canceled) return queuePaths(bucket, prefix, result.filePaths);
  },
  download: async (_, bucket, key) => {
    getClient();
    const result = await dialog.showSaveDialog(win, {
      defaultPath: path.basename(key),
    });
    if (!result.canceled)
      downloadToFile(bucket, key, result.filePath).catch(() => {});
  },
  downloadFolder: async (_, bucket, prefix) => {
    getClient();
    if (prefix && !prefix.endsWith("/"))
      throw new Error("Choose a folder, not a file.");
    const selected = await dialog.showOpenDialog(win, {
      title: "Save complete folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (selected.canceled) return;
    const objects = await listTree(bucket, prefix);
    const name = (prefix.split("/").filter(Boolean).pop() || bucket).replace(
      /[\/\\\0]/g,
      "_",
    );
    const root = path.join(
      selected.filePaths[0],
      name + "-" + Date.now() + "-" + crypto.randomUUID().slice(0, 4),
    );
    const destinations = objects
      .map((object) => ({ object, relative: object.Key.slice(prefix.length) }))
      .filter((x) => x.relative)
      .map((x) => ({ ...x, destination: safeDownloadPath(root, x.relative) }));
    await fsp.mkdir(root, { recursive: false });
    let count = 0;
    const promises = [];
    for (const item of destinations) {
      if (item.object.Key.endsWith("/"))
        await fsp.mkdir(item.destination, { recursive: true });
      else {
        count++;
        promises.push(
          downloadToFile(bucket, item.object.Key, item.destination, root),
        );
      }
    }
    Promise.allSettled(promises).then((results) => {
      const failed = results.filter((r) => r.status === "rejected").length;
      log(
        failed
          ? "Folder download finished with " +
              failed +
              " failed/cancelled file(s). See Transfers."
          : "Folder download complete: " + root,
      );
    });
    log("Queued complete folder: " + count + " file(s)");
    return { files: count, destination: root };
  },
  remove: async (_, bucket, key) => {
    assertNoFileOperation();
    const identity = connectionId();
    blockBusyDelete(bucket, key);
    const result = await dialog.showMessageBox(win, {
      type: "warning",
      message: "Delete this file from Backblaze?",
      detail:
        key +
        "\nHide current file removes it from the live file list. Older versions remain in Backblaze history. To remove stored versions too, choose Delete all versions.",
      buttons: ["Cancel", "Hide current file", "Delete all versions"],
      defaultId: 0,
      cancelId: 0,
    });
    if (result.response === 2) {
      if (connectionId() !== identity)
        throw new Error("Connection changed. Review this operation again.");
      return handlers.purgeFile(null, bucket, key);
    }
    if (result.response !== 1) return false;
    return withFileOperation("Deleting cloud file", async () => {
      if (connectionId() !== identity)
        throw new Error("Connection changed. Review this operation again.");
      blockBusyDelete(bucket, key);
      await deleteKey(bucket, key);
      const remaining = await getClient().send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: key, MaxKeys: 1 }),
      );
      if (remaining.Contents?.some((f) => f.Key === key))
        throw new Error(
          "Backblaze has not confirmed deletion yet. Refresh and try again.",
        );
      cloudChanged();
      log("Deleted: " + key);
      return true;
    });
  },
  removeFolder: async (_, bucket, prefix) => {
    assertNoFileOperation();
    const identity = connectionId();
    if (!prefix || !prefix.endsWith("/"))
      throw new Error("Choose a non-root folder to delete.");
    blockBusyDelete(bucket, prefix, true);
    const objects = await listTree(bucket, prefix);
    const answer = await dialog.showMessageBox(win, {
      type: "warning",
      message: "Delete this folder and all current files?",
      detail:
        prefix +
        "\n" +
        objects.length +
        " objects. Older versions may remain; retention rules apply.",
      buttons: ["Cancel", "Delete folder"],
      cancelId: 0,
      defaultId: 0,
    });
    if (answer.response !== 1) return false;
    return withFileOperation("Deleting cloud folder", async () => {
      if (connectionId() !== identity)
        throw new Error("Connection changed. Review this operation again.");
      blockBusyDelete(bucket, prefix, true);
      let removed = 0;
      try {
        for (const object of objects) {
          await deleteKey(bucket, object.Key);
          removed++;
        }
      } catch (error) {
        cloudChanged();
        throw new Error(
          removed + " objects deleted before the error: " + error.message,
        );
      }
      cloudChanged();
      const remaining = await getClient().send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          MaxKeys: 1,
        }),
      );
      if (remaining.Contents?.length)
        throw new Error(
          "Some files remain in this cloud folder. Another upload or retention rule may be preventing complete deletion.",
        );
      log("Deleted folder: " + prefix);
      return { deleted: removed };
    });
  },
  versions: async (_, bucket, key, marker) => {
    const r = await getClient().send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: key,
        MaxKeys: 1000,
        KeyMarker: marker?.key,
        VersionIdMarker: marker?.version,
      }),
    );
    return {
      versions: (r.Versions || [])
        .filter((v) => v.Key === key)
        .map((v) => ({
          id: v.VersionId,
          size: v.Size,
          modified: v.LastModified?.toISOString(),
          latest: v.IsLatest,
        })),
      markers: (r.DeleteMarkers || [])
        .filter((v) => v.Key === key)
        .map((v) => ({
          id: v.VersionId,
          modified: v.LastModified?.toISOString(),
          latest: v.IsLatest,
        })),
      next: r.IsTruncated
        ? { key: r.NextKeyMarker, version: r.NextVersionIdMarker }
        : null,
    };
  },
  restore: async (_, bucket, key, version) => {
    assertNoFileOperation();
    const identity = connectionId();
    blockBusyDelete(bucket, key);
    const head = await getClient().send(
      new HeadObjectCommand({ Bucket: bucket, Key: key, VersionId: version }),
    );
    if (head.ContentLength > 5 * 1024 ** 3)
      throw new Error(
        "In-app restore currently supports versions up to 5 GB. Download the larger version using Backblaze.",
      );
    const r = await dialog.showMessageBox(win, {
      message: "Restore this version?",
      detail: "A new current copy of " + key + " will be created.",
      buttons: ["Cancel", "Restore"],
      cancelId: 0,
    });
    if (r.response !== 1) return false;
    return withFileOperation("Restoring stored version", async () => {
      if (connectionId() !== identity)
        throw new Error("Connection changed. Review this operation again.");
      blockBusyDelete(bucket, key);
      await getClient().send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: key,
          CopySource: copySource(bucket, key, version),
        }),
      );
      cloudChanged();
      log("Restored version: " + key);
      return true;
    });
  },
  share: async (_, bucket, key) => {
    const url = await getSignedUrl(
      getClient(),
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: 3600 },
    );
    clipboard.writeText(url);
    return "Private download link copied. It expires in 1 hour; anyone with the link can download.";
  },
  mkdir: async (_, bucket, prefix, name) => {
    return withFileOperation("Creating cloud folder", async () => {
      name = typeof name === "string" ? name.trim() : "";
      if (
        !name?.trim() ||
        /[\\/\x00-\x1f]/.test(name) ||
        name === "." ||
        name === ".."
      )
        throw new Error("Enter a folder name without slashes.");
      await getClient().send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: joinKey(prefix, name.trim()) + "/",
          Body: "",
        }),
      );
      cloudChanged();
    });
  },
  installFinderSync: async () => {
    if (process.platform !== "darwin")
      throw new Error("Finder sync requires macOS.");
    const destination = await installFinderSync(
      app.getPath("home"),
      app.getPath("exe"),
    );
    emit();
    return destination;
  },
  openSyncFolder: async (_, id) => {
    const job = jobs.find((item) => item.id === id);
    if (!job) throw new Error("Folder sync no longer exists.");
    const failure = await shell.openPath(job.folder);
    if (failure) throw new Error(failure);
  },
  addFolderSync: async (_, bucket, prefix) => {
    const chosen = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
    });
    if (chosen.canceled) return null;
    const job = await registerSync(bucket, prefix, chosen.filePaths[0]);
    if (job) runBackup(job.id, true).catch((error) => log(error.message));
    return job;
  },
  addBackup: async (_, bucket, prefix, interval) => {
    getClient();
    if (![5, 60, 1440].includes(interval))
      throw new Error("Invalid backup interval");
    const r = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
    });
    if (r.canceled) return;
    const folder = r.filePaths[0];
    const j = {
      id: crypto.randomUUID(),
      name: path.basename(folder),
      folder,
      bucket,
      prefix:
        joinKey(
          prefix,
          "Backups/" +
            path.basename(folder) +
            "-" +
            crypto.randomUUID().slice(0, 6),
        ) + "/",
      interval,
      enabled: true,
      endpoint: connection.endpoint,
      keyId: connection.keyId,
    };
    jobs.push(j);
    persist();
    emit();
    return j;
  },
  runBackup: (_, id) => runBackup(id, true),
  toggleBackup: (_, id) => {
    const j = jobs.find((j) => j.id === id);
    if (j) {
      j.enabled = !j.enabled;
      persist();
      emit();
    }
  },
  removeBackup: async (_, id) => {
    const j = jobs.find((j) => j.id === id);
    if (j?.running) throw new Error("Wait for this backup to finish.");
    jobs = jobs.filter((j) => j.id !== id);
    persist();
    emit();
  },
  cancel: async (_, id) => {
    const t = transfers.find((t) => t.id === id);
    if (!t || !["queued", "running"].includes(t.status)) return;
    t.status = "cancelled";
    await active.get(id)?.();
    emit();
  },
};
app.setName("BlazeSync");
const smoke = process.argv.includes("--smoke-test");
if (smoke)
  app.setPath(
    "userData",
    path.join(app.getPath("temp"), "blazesync-smoke-" + process.pid),
  );
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on("second-instance", (_, args) => {
  const paths = syncArguments(args);
  if (paths.length)
    app
      .whenReady()
      .then(() => syncFinderPaths(paths))
      .catch((error) => dropError(error));
  else if (win) showMain();
});
app.whenReady().then(() => {
  if (!primaryInstance) return;
  if (process.platform === "darwin") app.dock.hide();
  try {
    preferences = {
      ...preferences,
      ...JSON.parse(fs.readFileSync(preferencesPath(), "utf8")),
    };
  } catch {}
  if (!["dark", "light", "system"].includes(preferences.theme))
    preferences.theme = "dark";
  if (![0, 15, 30, 60].includes(preferences.refreshSeconds))
    preferences.refreshSeconds = 15;
  if (
    !Number.isInteger(preferences.billingPaymentDay) ||
    preferences.billingPaymentDay < 0 ||
    preferences.billingPaymentDay > 31
  )
    preferences.billingPaymentDay = 0;
  nativeTheme.themeSource = preferences.theme;
  nativeTheme.on("updated", emit);
  setInterval(() => {
    let changed = false;
    for (const t of transfers)
      if (
        t.status === "running" &&
        t.lastProgressAt &&
        Date.now() - t.lastProgressAt > 3000 &&
        t.speed
      ) {
        t.speed = 0;
        t.eta = null;
        changed = true;
      }
    if (changed) emit();
  }, 1000);

  try {
    const s = JSON.parse(fs.readFileSync(statePath(), "utf8"));
    jobs = (s.jobs || []).map((j) => ({ ...j, running: false }));
    pendingSavedSecret = s.secret || null;
    restoreSavedConnection();
  } catch (e) {
    if (e.code !== "ENOENT")
      events.push({
        id: crypto.randomUUID(),
        at: Date.now(),
        message:
          "Saved connection could not be read. Your stored data has been kept. Check Settings.",
      });
  }
  for (const [name, fn] of Object.entries(handlers))
    ipcMain.handle("vault:" + name, async (e, ...args) => {
      if (e.sender !== win.webContents && e.sender !== trayWindow?.webContents)
        throw new Error("Unknown window");
      try {
        return await fn(e, ...args);
      } catch (err) {
        throw new Error(err.message);
      }
    });
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 760,
    minHeight: 700,
    title: "BlazeSync",
    show: false,
    backgroundColor: "#f7f8fa",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.loadFile(path.join(__dirname, "../dist/index.html"));
  createTray();
  if (smoke)
    win.webContents.once("did-finish-load", async () => {
      try {
        await require("./smoke.cjs")({
          app,
          win,
          trayWindow,
          tray,
          showMain,
          togglePanel,
          handlers,
          dialog,
          uploadFile,
          runBackup,
          jobs,
          getState: publicState,
          emit,
          progressEmit,
          checkConnection,
          restoreSavedConnection,
          simulateLockedSave: () => {
            const saved = JSON.parse(fs.readFileSync(statePath(), "utf8"));
            pendingSavedSecret = saved.secret;
            client = null;
            connection = null;
            persist();
            const kept =
              JSON.parse(fs.readFileSync(statePath(), "utf8")).secret ===
              saved.secret;
            restoreSavedConnection();
            return kept;
          },
          simulateRestart: () => {
            const saved = JSON.parse(fs.readFileSync(statePath(), "utf8"));
            pendingSavedSecret = saved.secret;
            client = null;
            connection = null;
            restoreSavedConnection();
          },
          setTestConnection: (c, s3) => {
            connection = c;
            client = configureCloudClient(s3);
            cloudLimit = null;
            emit();
          },
          outputDir:
            process.env.BLAZESYNC_SMOKE_OUTPUT ||
            path.join(__dirname, "../assets"),
        });
      } catch (error) {
        console.error(error);
        app.exit(1);
      }
    });
  if (!smoke) {
    const finderPaths = syncArguments(process.argv);
    if (finderPaths.length)
      win.webContents.once("did-finish-load", () =>
        syncFinderPaths(finderPaths).catch((error) => dropError(error)),
      );
    checkPaymentReminder();
    setInterval(checkPaymentReminder, 60000);
    powerMonitor.on("resume", checkPaymentReminder);
    powerMonitor.on("unlock-screen", checkPaymentReminder);
    checkConnection();
    setInterval(checkConnection, 30000);
    powerMonitor.on("resume", checkConnection);
    powerMonitor.on("unlock-screen", checkConnection);
  }
  setInterval(() => {
    if (client && !fileOperation && !jobs.some((job) => job.running))
      for (const j of jobs)
        if (
          due(j) &&
          j.endpoint === connection.endpoint &&
          j.keyId === connection.keyId
        ) {
          runBackup(j.id).catch((e) => log(e.message));
          break;
        }
  }, 30000);
});
app.on("window-all-closed", () => {
  if (isQuitting) app.quit();
});
app.on("activate", () => {
  if (win) showMain();
});
app.on("will-quit", () => {
  isQuitting = true;
  if (progressTimer) {
    clearTimeout(progressTimer);
    progressTimer = null;
  }
  if (tray && !tray.isDestroyed()) tray.destroy();
});
app.on("before-quit", (event) => {
  isQuitting = true;
  if (
    active.size ||
    jobs.some((j) => j.running) ||
    transfers.some((t) => t.status === "queued") ||
    fileOperation
  ) {
    showMain("transfers");
    const choice = dialog.showMessageBoxSync(win, {
      type: "warning",
      message: "Transfers or backups are still running.",
      detail:
        "Keep BlazeSync open to finish them. Quitting interrupts active work.",
      buttons: ["Keep open", "Quit anyway"],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice === 0) {
      event.preventDefault();
      isQuitting = false;
    }
  }
});
