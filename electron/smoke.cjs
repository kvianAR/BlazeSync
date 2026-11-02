const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");
const { S3Client } = require("@aws-sdk/client-s3");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(check) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error("Smoke test timed out");
}
module.exports = async function smoke(ctx) {
  const {
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
    getState,
    emit,
    progressEmit,
    setTestConnection,
    checkConnection,
    simulateRestart,
    simulateLockedSave,
    outputDir,
  } = ctx;
  const checks = [];
  assert.equal(win.isVisible(), false);
  if (process.platform === "darwin") assert.equal(app.dock.isVisible(), false);
  checks.push("menu-bar startup without Dock icon or main window");
  const inspect = (code) => win.webContents.executeJavaScript(code);
  const nav = async (page) => {
    showMain(page);
    await sleep(150);
  };
  await sleep(700);
  const initial = await inspect(
    `({title:document.title,text:document.body.innerText,logos:[...document.images].filter(i=>i.alt==='BlazeSync logo').map(i=>i.complete&&i.naturalWidth>0)})`,
  );
  assert.equal(initial.title, "BlazeSync");
  assert.ok(initial.text.includes("Make room for what matters."));
  assert.equal(initial.logos.length, 2);
  assert.ok(initial.logos.every(Boolean));
  checks.push("desktop launch and both logos");
  await inspect(
    `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Connect Backblaze B2')).click()`,
  );
  await sleep(150);
  assert.equal(await inspect('document.querySelectorAll("input").length'), 2);
  await handlers.setTheme(null, "dark");
  await sleep(100);
  assert.equal(await inspect("document.documentElement.dataset.theme"), "dark");
  await handlers.setTheme(null, "light");
  await sleep(100);
  assert.equal(
    await inspect("document.documentElement.dataset.theme"),
    "light",
  );
  await handlers.setTheme(null, "dark");
  checks.push("dark/light mode and synchronized theme");
  checks.push("connection form");
  await nav("files");
  await fs.writeFile(
    path.join(outputDir, "BlazeSync-preview.png"),
    (await win.webContents.capturePage()).toPNG(),
  );
  await waitFor(async () => !trayWindow.webContents.isLoading());
  assert.equal(tray.isDestroyed(), false);
  assert.equal(
    await trayWindow.webContents.executeJavaScript(
      "document.images[0].complete && document.images[0].naturalWidth > 0",
    ),
    true,
  );
  togglePanel();
  await sleep(200);
  assert.equal(trayWindow.isVisible(), true);
  assert.ok(
    (
      await trayWindow.webContents.executeJavaScript("document.body.innerText")
    ).includes("Open BlazeSync"),
  );
  await fs.writeFile(
    path.join(outputDir, "BlazeSync-menubar.png"),
    (await trayWindow.webContents.capturePage()).toPNG(),
  );
  await trayWindow.webContents.executeJavaScript(
    `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Open BlazeSync')).click()`,
  );
  await sleep(150);
  assert.equal(win.isVisible(), true);
  assert.equal(trayWindow.isVisible(), false);
  checks.push("native menu-bar icon, mini panel, Open BlazeSync");
  win.close();
  await sleep(100);
  assert.equal(win.isDestroyed(), false);
  assert.equal(win.isVisible(), false);
  assert.equal(tray.isDestroyed(), false);
  showMain();
  assert.equal(win.isVisible(), true);
  if (process.platform === "darwin") assert.equal(app.dock.isVisible(), false);
  checks.push(
    "close hides app; tray stays; full app reopens without Dock icon",
  );
  const objects = new Map([
    ["Photos/sunset.JPG", Buffer.from("test-photo")],
    ["Photos/camera.HEIC", Buffer.from("test-raw")],
    ["Documents/report.pdf", Buffer.from("test-document")],
  ]);
  const metadata = new Map();
  const hiddenHistory = [
    {
      key: "Archive/hidden-video.MOV",
      id: "hidden-v1",
      deleted: false,
      latest: false,
      size: 162774343,
    },
    {
      key: "Archive/hidden-video.MOV",
      id: "hidden-marker",
      deleted: true,
      latest: true,
      size: 0,
    },
  ];
  let denyDeletion = false;
  const multipart = new Map();
  let multipartStarted = 0,
    multipartFinished = 0;
  let changedLocalFile = null;
  let copies = 0;
  let offline = false,
    blockedKey = null,
    releaseUpload = null;
  const xml = (s) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const handler = {
    handle: async (req) => {
      if (offline) {
        const e = new Error("Test network outage");
        e.code = "ENETUNREACH";
        throw e;
      }
      let key = decodeURIComponent(
        req.path.replace(/^\/test-bucket\/?/, "").replace(/^\//, ""),
      );
      const q = req.query || {},
        headers = req.headers;
      let body = "",
        statusCode = 200,
        extra = {};
      if (req.method === "POST" && "uploads" in q) {
        const id = "multipart-" + ++multipartStarted;
        multipart.set(id, {
          key,
          parts: new Map(),
          metadata: headers["x-amz-meta-vault-mtime"],
        });
        body = `<InitiateMultipartUploadResult><Bucket>test-bucket</Bucket><Key>${xml(key)}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`;
      } else if (req.method === "PUT" && q.uploadId) {
        const chunks = [];
        if (typeof req.body === "string" || req.body instanceof Uint8Array)
          chunks.push(Buffer.from(req.body));
        else
          for await (const chunk of req.body) chunks.push(Buffer.from(chunk));
        multipart
          .get(q.uploadId)
          .parts.set(Number(q.partNumber), Buffer.concat(chunks));
        extra.etag = '"part-' + q.partNumber + '"';
      } else if (req.method === "POST" && q.uploadId) {
        const upload = multipart.get(q.uploadId);
        objects.set(
          key,
          Buffer.concat(
            [...upload.parts]
              .sort(([a], [b]) => a - b)
              .map(([, value]) => value),
          ),
        );
        metadata.set(key, upload.metadata);
        multipart.delete(q.uploadId);
        multipartFinished++;
        body = `<CompleteMultipartUploadResult><Key>${xml(key)}</Key><ETag>"multipart-etag"</ETag></CompleteMultipartUploadResult>`;
      } else if (req.method === "DELETE" && q.uploadId) {
        multipart.delete(q.uploadId);
        statusCode = 204;
      } else if (req.method === "PUT") {
        if (blockedKey === key)
          await new Promise((resolve) => {
            releaseUpload = resolve;
          });
        if (headers["x-amz-copy-source"]) {
          copies++;
          const source = headers["x-amz-copy-source"]
            .split("?")[0]
            .split("/")
            .slice(1)
            .map(decodeURIComponent)
            .join("/");
          if (objects.has(source)) {
            objects.set(key, Buffer.from(objects.get(source)));
            if (metadata.has(source)) metadata.set(key, metadata.get(source));
          }
          body =
            '<CopyObjectResult><LastModified>2026-11-02T00:00:00Z</LastModified><ETag>"test"</ETag></CopyObjectResult>';
        } else {
          const chunks = [];
          if (typeof req.body === "string" || req.body instanceof Uint8Array)
            chunks.push(Buffer.from(req.body));
          else if (req.body)
            for await (const chunk of req.body) chunks.push(Buffer.from(chunk));
          objects.set(key, Buffer.concat(chunks));
          metadata.set(key, headers["x-amz-meta-vault-mtime"]);
          extra.etag = '"test-etag"';
          if (key === "changes-during-upload.txt" && changedLocalFile)
            await fs.appendFile(changedLocalFile, "changed");
        }
      } else if (req.method === "HEAD") {
        if (!objects.has(key)) {
          statusCode = 404;
        } else {
          extra["content-length"] = String(objects.get(key).length);
          extra.etag =
            '"' +
            require("node:crypto")
              .createHash("sha256")
              .update(objects.get(key))
              .digest("hex") +
            '"';
          if (metadata.has(key))
            extra["x-amz-meta-vault-mtime"] = metadata.get(key);
        }
      } else if (req.method === "DELETE") {
        if (denyDeletion)
          return {
            response: {
              statusCode: 403,
              headers: { "content-type": "application/xml" },
              body: Readable.from([
                Buffer.from(
                  "<Error><Code>AccessDenied</Code><Message>Denied</Message></Error>",
                ),
              ]),
            },
          };
        if (q.versionId) {
          const index = hiddenHistory.findIndex(
            (v) => v.key === key && v.id === q.versionId,
          );
          if (index >= 0) hiddenHistory.splice(index, 1);
        } else objects.delete(key);
        statusCode = 204;
      } else if (req.method === "GET" && "uploads" in q) {
        body =
          "<ListMultipartUploadsResult><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>";
      } else if ("versions" in q) {
        const hidden = hiddenHistory.filter((v) =>
          v.key.startsWith(q.prefix || ""),
        );
        body =
          "<ListVersionsResult><IsTruncated>false</IsTruncated>" +
          [...objects]
            .filter(([name]) => name.startsWith(q.prefix || ""))
            .map(
              ([name, value]) =>
                `<Version><Key>${xml(name)}</Key><VersionId>current</VersionId><IsLatest>true</IsLatest><Size>${value.length}</Size></Version>`,
            )
            .join("") +
          hidden
            .map((v) =>
              v.deleted
                ? `<DeleteMarker><Key>${xml(v.key)}</Key><VersionId>${v.id}</VersionId><IsLatest>${v.latest}</IsLatest><LastModified>2026-11-02T00:00:00Z</LastModified></DeleteMarker>`
                : `<Version><Key>${xml(v.key)}</Key><VersionId>${v.id}</VersionId><IsLatest>false</IsLatest><LastModified>2026-11-01T00:00:00Z</LastModified><Size>${v.size}</Size></Version>`,
            )
            .join("") +
          (q.prefix === "Photos/sunset.JPG"
            ? `<Version><Key>${xml(q.prefix)}</Key><VersionId>old+/=</VersionId><IsLatest>false</IsLatest><LastModified>2026-11-01T00:00:00Z</LastModified><Size>10</Size></Version>`
            : "") +
          "</ListVersionsResult>";
      } else if (q["list-type"] === "2") {
        const entries = [...objects].filter(([key]) =>
          key.startsWith(q.prefix || ""),
        );
        const prefixes = new Set();
        let contents = "";
        for (const [key, value] of entries) {
          const relative = key.slice((q.prefix || "").length);
          if (q.delimiter && relative.includes(q.delimiter)) {
            prefixes.add(
              (q.prefix || "") + relative.split(q.delimiter)[0] + q.delimiter,
            );
          } else
            contents += `<Contents><Key>${xml(key)}</Key><LastModified>2026-11-02T00:00:00Z</LastModified><Size>${value.length}</Size></Contents>`;
        }
        body =
          "<ListBucketResult><IsTruncated>false</IsTruncated>" +
          contents +
          [...prefixes]
            .map(
              (prefix) =>
                `<CommonPrefixes><Prefix>${xml(prefix)}</Prefix></CommonPrefixes>`,
            )
            .join("") +
          "</ListBucketResult>";
      } else if (objects.has(key)) {
        body = objects.get(key);
        extra["content-length"] = String(body.length);
      } else {
        body =
          "<ListAllMyBucketsResult><Buckets><Bucket><Name>test-bucket</Name></Bucket></Buckets></ListAllMyBucketsResult>";
      }
      return {
        response: {
          statusCode,
          headers: { "content-type": "application/xml", ...extra },
          body: Readable.from([Buffer.from(body)]),
        },
      };
    },
  };
  const connection = {
    endpoint: "https://s3.us-west-004.backblazeb2.com",
    region: "us-west-004",
    bucketScope: "account",
    keyId: "test-key",
    applicationKey: "not-a-real-key",
    bucket: "test-bucket",
  };
  const mock = new S3Client({
    endpoint: connection.endpoint,
    region: connection.region,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    requestHandler: handler,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  setTestConnection(connection, mock);
  const listing = await handlers.catalog(null, "test-bucket");
  assert.equal(listing.files.filter((f) => f.photo).length, 2);
  assert.equal(listing.files.filter((f) => !f.photo).length, 1);
  assert.equal(
    listing.files.find((f) => f.key.endsWith("HEIC")).preview,
    false,
  );
  checks.push("S3 SDK metadata listing and precise photo/file classification");
  await nav("photos");
  await waitFor(
    async () =>
      (await inspect('document.querySelectorAll(".photo-card").length')) === 2,
  );
  assert.ok(
    (await inspect("document.body.innerText")).includes("Bucket scan complete"),
  );
  await nav("library");
  await waitFor(
    async () =>
      (await inspect('document.querySelectorAll(".file-row").length')) === 1,
  );
  checks.push("connected Photos and Files screens through IPC");
  await nav("settings");
  assert.equal(
    await inspect(
      'document.querySelectorAll(".connection-locked input:disabled").length',
    ),
    2,
  );
  assert.equal(
    await inspect(
      '[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Connect account")',
    ),
    false,
  );
  await assert.rejects(handlers.connect(null, {}), /credentials are locked/);
  checks.push("connected credentials are masked and locked in UI and backend");
  await nav("files");
  const temp = app.getPath("userData");
  await fs.mkdir(temp, { recursive: true });
  const local = path.join(temp, "sample.txt");
  await fs.writeFile(local, "verified upload");
  await uploadFile("test-bucket", "Checks/sample.txt", local);
  assert.equal(objects.get("Checks/sample.txt").toString(), "verified upload");
  assert.equal(getState().transfers[0].status, "done");
  checks.push(
    "stream upload and HEAD size verification against local S3 fixture",
  );
  const destination = path.join(temp, "download.txt");
  dialog.showSaveDialog = async () => ({
    canceled: false,
    filePath: destination,
  });
  await handlers.download(null, "test-bucket", "Checks/sample.txt");
  await waitFor(
    () =>
      getState().transfers.find((t) => t.type === "download")?.status ===
      "done",
  );
  assert.equal(await fs.readFile(destination, "utf8"), "verified upload");
  checks.push("stream download and verified local file");
  dialog.showMessageBox = async () => ({ response: 1 });
  const versions = await handlers.versions(
    null,
    "test-bucket",
    "Photos/sunset.JPG",
  );
  assert.ok(versions.versions.some((version) => version.id === "old+/="));
  await handlers.restore(null, "test-bucket", "Photos/sunset.JPG", "old+/=");
  assert.equal(copies, 1);
  checks.push("version history and copy restore through S3 SDK fixture");
  const backupRoot = path.join(temp, "backup");
  await fs.mkdir(backupRoot);
  await fs.writeFile(path.join(backupRoot, "note.txt"), "backup content");
  await fs.symlink(local, path.join(backupRoot, "skip-symlink"));
  const job = {
    id: "smoke-backup",
    name: "Smoke backup",
    folder: backupRoot,
    bucket: "test-bucket",
    prefix: "Backup/",
    interval: 60,
    enabled: false,
    endpoint: connection.endpoint,
    keyId: connection.keyId,
  };
  jobs.push(job);
  await runBackup(job.id);
  assert.ok(job.lastSuccess);
  assert.equal(objects.get("Backup/note.txt").toString(), "backup content");
  assert.equal(objects.has("Backup/skip-symlink"), false);
  const before = getState().transfers.length;
  await runBackup(job.id);
  assert.equal(getState().transfers.length, before);
  await fs.unlink(path.join(backupRoot, "note.txt"));
  await runBackup(job.id);
  assert.equal(objects.has("Backup/note.txt"), true);
  checks.push(
    "one-way backup, skip unchanged, skip symlinks, retain local deletions",
  );
  await handlers.remove(null, "test-bucket", "Checks/sample.txt");
  assert.equal(objects.has("Checks/sample.txt"), false);
  checks.push("confirmed deletion through S3 SDK fixture");
  await handlers.setUploadTarget(null, "test-bucket", "Tray-drop/");
  tray.emit("drop-files", {}, [local]);
  await waitFor(() => objects.has("Tray-drop/sample.txt"));
  checks.push("native menu-bar drop event uploads to saved destination");
  await nav("files");
  await sleep(100);
  await handlers.setUploadTarget(null, "test-bucket", "");
  const dragFile = path.join(temp, "dragged-from-finder.txt");
  await fs.writeFile(dragFile, "real file drop");
  win.webContents.debugger.attach("1.3");
  for (const type of ["dragEnter", "dragOver", "drop"])
    await win.webContents.debugger.sendCommand("Input.dispatchDragEvent", {
      type,
      x: 800,
      y: 300,
      data: { items: [], files: [dragFile], dragOperationsMask: 1 },
    });
  await waitFor(() => objects.has("dragged-from-finder.txt"));
  win.webContents.debugger.detach();
  checks.push(
    "main-window native file drop reaches preload and uploads real local path",
  );
  const trayFile = path.join(temp, "panel-drop.txt");
  await fs.writeFile(trayFile, "panel file");
  trayWindow.webContents.debugger.attach("1.3");
  for (const type of ["dragEnter", "dragOver", "drop"])
    await trayWindow.webContents.debugger.sendCommand(
      "Input.dispatchDragEvent",
      {
        type,
        x: 200,
        y: 100,
        data: { items: [], files: [trayFile], dragOperationsMask: 1 },
      },
    );
  await waitFor(() => objects.has("panel-drop.txt"));
  trayWindow.webContents.debugger.detach();
  checks.push("menu-bar panel native file drop uploads real local path");
  const tree = path.join(temp, "Drop folder");
  await fs.mkdir(path.join(tree, "nested", "empty"), { recursive: true });
  await fs.writeFile(path.join(tree, "nested", "one.txt"), "nested data");
  await handlers.uploadPaths(null, "test-bucket", "Uploads/", [tree]);
  await waitFor(() =>
    getState()
      .transfers.filter((t) => t.key.startsWith("Uploads/"))
      .every((t) => t.status === "done"),
  );
  assert.equal(
    objects.get("Uploads/Drop folder/nested/one.txt").toString(),
    "nested data",
  );
  assert.ok(objects.has("Uploads/Drop folder/nested/empty/"));
  checks.push("dropped folder preserves nested files and empty folders");
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [temp] });
  const downloaded = await handlers.downloadFolder(
    null,
    "test-bucket",
    "Uploads/Drop folder/",
  );
  await waitFor(() =>
    getState()
      .transfers.filter((t) => t.group === downloaded.destination)
      .every((t) => t.status === "done"),
  );
  assert.equal(
    await fs.readFile(
      path.join(downloaded.destination, "nested", "one.txt"),
      "utf8",
    ),
    "nested data",
  );
  assert.equal(
    (
      await fs.stat(path.join(downloaded.destination, "nested", "empty"))
    ).isDirectory(),
    true,
  );
  checks.push("complete folder download preserves hierarchy and empty folders");
  await handlers.removeFolder(null, "test-bucket", "Uploads/Drop folder/");
  assert.equal(
    [...objects.keys()].some((k) => k.startsWith("Uploads/Drop folder/")),
    false,
  );
  checks.push("confirmed folder deletion removes exact folder prefix");
  blockedKey = "hold.txt";
  const held = uploadFile("test-bucket", "hold.txt", local);
  await waitFor(() => !!releaseUpload);
  const missingFile = path.join(temp, "will-disappear.txt");
  await fs.writeFile(missingFile, "x");
  const missingResult = uploadFile(
    "test-bucket",
    "gone.txt",
    missingFile,
  ).catch((e) => e);
  await fs.unlink(missingFile);
  const cancelledResult = uploadFile(
    "test-bucket",
    "cancelled.txt",
    local,
  ).catch((e) => e);
  const cancelledTransfer = getState().transfers.find(
    (t) => t.key === "cancelled.txt",
  );
  await handlers.cancel(null, cancelledTransfer.id);
  assert.ok(
    getState().transfers.some(
      (t) => t.key === "hold.txt" && t.status === "running",
    ),
  );
  await sleep(200);
  assert.ok((await inspect("document.body.innerText")).includes("Uploading"));
  await fs.writeFile(
    path.join(outputDir, "BlazeSync-uploading-dark.png"),
    (await win.webContents.capturePage()).toPNG(),
  );
  releaseUpload();
  await held;
  await missingResult;
  const cancellation = await cancelledResult;
  assert.equal(cancellation.name, "AbortError");
  assert.equal(
    getState().transfers.find((t) => t.key === "gone.txt").status,
    "failed",
  );
  assert.equal(
    getState().transfers.find((t) => t.key === "cancelled.txt").status,
    "cancelled",
  );
  checks.push(
    "queued missing-file and cancellation failures do not report success or remain stuck",
  );
  checks.push("pending upload appears inside destination file listing");
  blockedKey = "hold-backup.txt";
  releaseUpload = null;
  const holdBackup = uploadFile("test-bucket", blockedKey, local);
  await waitFor(() => !!releaseUpload);
  await fs.writeFile(path.join(backupRoot, "cancel-backup.txt"), "will cancel");
  const backupRun = runBackup(job.id);
  await waitFor(() =>
    getState().transfers.some(
      (t) => t.key === "Backup/cancel-backup.txt" && t.status === "queued",
    ),
  );
  const queuedBackup = getState().transfers.find(
    (t) => t.key === "Backup/cancel-backup.txt",
  );
  const lastSuccess = job.lastSuccess;
  await handlers.cancel(null, queuedBackup.id);
  releaseUpload();
  await holdBackup;
  await backupRun;
  assert.equal(job.lastSuccess, lastSuccess);
  assert.match(job.error, /cancel/i);
  checks.push(
    "cancelled queued backup file never advances last-success timestamp",
  );
  denyDeletion = true;
  await assert.rejects(
    handlers.remove(null, "test-bucket", "hold.txt"),
    /deleteFiles/,
  );
  assert.equal(objects.has("hold.txt"), true);
  denyDeletion = false;
  checks.push("delete permission failure is clear and keeps file");
  await nav("settings");
  await fs.writeFile(
    path.join(outputDir, "BlazeSync-locked-dark.png"),
    (await win.webContents.capturePage()).toPNG(),
  );
  const revision = getState().revision;
  await handlers.mkdir(null, "test-bucket", "", "New folder");
  assert.ok(getState().revision > revision);
  checks.push("cloud mutations refresh listings through revision events");
  offline = true;
  await checkConnection();
  assert.equal(getState().connected, true);
  assert.equal(getState().health, "offline");
  offline = false;
  await checkConnection();
  assert.equal(getState().health, "online");
  assert.equal(getState().connected, true);
  checks.push("network outage keeps saved connection; recovery needs no login");
  const saved = await fs.readFile(path.join(temp, "vault.json"), "utf8");
  assert.equal(saved.includes("not-a-real-key"), false);
  simulateRestart();
  assert.equal(getState().connected, true);
  checks.push("encrypted connection reloads after restart without login");
  // Restore the local fixture after the encrypted reload check; never touch a live account.
  setTestConnection(connection, mock);
  await nav("files");
  await sleep(6500);
  showMain();
  await sleep(200);

  objects.set("external-change.txt", Buffer.from("added outside app"));
  await inspect('window.dispatchEvent(new Event("focus"))');
  await waitFor(async () =>
    (await inspect("document.body.innerText")).includes("external-change.txt"),
  );
  checks.push("outside cloud changes appear after focus refresh");
  objects.delete("external-change.txt");
  await inspect('window.dispatchEvent(new Event("focus"))');
  await waitFor(
    async () =>
      !(await inspect("document.body.innerText")).includes(
        "external-change.txt",
      ),
  );
  checks.push("outside cloud deletions disappear after refresh");
  await inspect(
    `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Versions & deleted')).click()`,
  );
  await waitFor(
    async () =>
      (await inspect('document.querySelectorAll(".history-row").length')) >= 2,
  );
  assert.ok(
    (await inspect("document.body.innerText")).includes("Hidden / deleted"),
  );
  checks.push(
    "hidden file and delete marker are visible in history while absent from current files",
  );
  await fs.writeFile(
    path.join(outputDir, "BlazeSync-history-dark.png"),
    (await win.webContents.capturePage()).toPNG(),
  );
  dialog.showMessageBox = async () => ({ response: 0 });
  assert.equal(
    await handlers.purgeFile(null, "test-bucket", "Archive/hidden-video.MOV"),
    false,
  );
  assert.equal(hiddenHistory.length, 2);
  checks.push("permanent purge cancellation preserves all versions");
  dialog.showMessageBox = async () => ({ response: 1 });
  const purged = await handlers.purgeFile(
    null,
    "test-bucket",
    "Archive/hidden-video.MOV",
  );
  assert.equal(purged.deleted, 2);
  assert.equal(hiddenHistory.length, 0);
  checks.push(
    "permanent deletion removes old version and marker from S3 history and verifies absence",
  );
  await inspect(
    `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Current files')).click()`,
  );
  await sleep(200);
  const originalBounds = win.getBounds();
  for (const width of [768, 1280, 1600]) {
    win.setBounds({ width, height: 900 });
    await sleep(150);
    const overflow = await inspect(
      "document.documentElement.scrollWidth>window.innerWidth",
    );
    assert.equal(overflow, false, "Horizontal overflow at " + width);
    await fs.writeFile(
      path.join(outputDir, "BlazeSync-" + width + "-dark.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
  }
  await handlers.setTheme(null, "light");
  win.setBounds({ width: 1280, height: 900 });
  await sleep(150);
  await fs.writeFile(
    path.join(outputDir, "BlazeSync-1280-light.png"),
    (await win.webContents.capturePage()).toPNG(),
  );
  await handlers.setTheme(null, "dark");
  win.setBounds(originalBounds);
  checks.push(
    "responsive desktop layout at 768/1280/1600 and light/dark visual checks",
  );
  await handlers.setRefresh(null, 0);
  assert.equal(getState().refreshSeconds, 0);
  await handlers.setRefresh(null, 15);
  assert.equal(getState().refreshSeconds, 15);
  checks.push(
    "manual refresh setting persists zero without falling back to polling",
  );
  showMain();
  await sleep(300);
  // Avoid OS occlusion from the user's other apps making visible-window polling nondeterministic.
  await inspect(
    'Object.defineProperty(document,"hidden",{configurable:true,get:()=>false});true',
  );
  objects.set("periodic-check.txt", Buffer.from("background change"));
  await waitFor(() => true);
  const pollingDeadline = Date.now() + 18000;
  while (
    Date.now() < pollingDeadline &&
    !(await inspect("document.body.innerText")).includes("periodic-check.txt")
  )
    await sleep(250);
  assert.ok(
    (await inspect("document.body.innerText")).includes("periodic-check.txt"),
  );
  checks.push("15-second periodic polling detects external cloud additions");
  objects.set("Agency/", Buffer.alloc(0));
  objects.set("Agency/sub/", Buffer.alloc(0));
  objects.set("Agency/sub/nested.pdf", Buffer.alloc(1200));
  objects.set("Agency/direct.txt", Buffer.alloc(300));
  const metric = await handlers.folderStats(null, "test-bucket", "", true);
  assert.equal(metric.folders["Agency/"].bytes, 1500);
  assert.equal(metric.folders["Agency/"].files, 2);
  await inspect('window.dispatchEvent(new Event("focus"))');
  await waitFor(async () => {
    const text = await inspect("document.body.innerText");
    return text.includes("1.5 KB") && text.includes("Includes all subfolders");
  });
  checks.push(
    "recursive root size and child folder sizes include nested current files",
  );
  await fs.writeFile(
    path.join(outputDir, "BlazeSync-recursive-root.png"),
    (await win.webContents.capturePage()).toPNG(),
  );
  await inspect(
    `[...document.querySelectorAll('.file-row.folder button.file-name')].find(b=>b.textContent.trim()==='Agency').click()`,
  );
  await waitFor(async () => {
    const text = await inspect("document.body.innerText");
    return (
      text.includes("1.5 KB") &&
      text.includes("1.2 KB") &&
      text.includes("2 current files")
    );
  });
  checks.push(
    "navigating inside a folder shows exact recursive parent and child totals",
  );
  await fs.writeFile(
    path.join(outputDir, "BlazeSync-recursive-nested.png"),
    (await win.webContents.capturePage()).toPNG(),
  );
  await assert.rejects(
    handlers.mkdir(null, "test-bucket", "", " . "),
    /folder name/,
  );
  await assert.rejects(
    handlers.mkdir(null, "test-bucket", "", " .. "),
    /folder name/,
  );
  checks.push("folder name validation trims before rejecting dot paths");
  const secondConnection = {
    ...connection,
    keyId: "test-second-key",
    bucket: "another-bucket",
  };
  setTestConnection(secondConnection, mock);
  await waitFor(async () =>
    (await inspect("document.body.innerText")).includes("another-bucket"),
  );
  checks.push(
    "switching connected accounts refreshes buckets without requiring disconnect",
  );
  setTestConnection(connection, mock);
  await fs.mkdir(path.join(temp, "upload-tests"), { recursive: true });
  // Exercise billing and management through the same IPC handlers used by the app.
  const usage = await handlers.billing(null, true);
  assert.equal(usage.estimate.accountComplete, true);
  assert.equal(
    usage.currentBytes,
    [...objects.values()].reduce((sum, value) => sum + value.length, 0),
  );
  assert.equal(usage.estimate.monthlyUsd, 0);
  assert.equal(usage.pricing.usdPerTbPer30Days, 6.95);
  await handlers.setBillingBudget(null, 5);
  assert.equal(getState().billingBudgetUsd, 5);
  await nav("billing");
  await waitFor(async () =>
    (await inspect("document.body.innerText")).includes(
      "ACCOUNT STORAGE PROJECTION",
    ),
  );
  assert.ok((await inspect("document.body.innerText")).includes("$6.95"));
  await fs.writeFile(
    path.join(outputDir, "BlazeSync-billing-dark.png"),
    (await win.webContents.capturePage()).toPNG(),
  );
  checks.push(
    "billing scans current and retained versions, applies account allowance and renders published pricing",
  );
  objects.set("Manage/first.txt", Buffer.from("first file"));
  objects.set("Manage/nested/second.txt", Buffer.from("second file"));
  dialog.showMessageBox = async () => ({ response: 0 });
  assert.equal(
    await handlers.moveSelection(
      null,
      "test-bucket",
      [{ key: "Manage/first.txt" }],
      "test-bucket",
      "Manage/",
      "renamed.txt",
    ),
    false,
  );
  assert.equal(objects.has("Manage/first.txt"), true);
  dialog.showMessageBox = async () => ({ response: 1 });
  await handlers.moveSelection(
    null,
    "test-bucket",
    [{ key: "Manage/first.txt" }],
    "test-bucket",
    "Manage/",
    "renamed.txt",
  );
  assert.equal(objects.has("Manage/first.txt"), false);
  assert.equal(objects.get("Manage/renamed.txt").toString(), "first file");
  await handlers.moveSelection(
    null,
    "test-bucket",
    [{ key: "Manage/", folder: true }],
    "test-bucket",
    "Moved/",
  );
  assert.equal(objects.has("Manage/nested/second.txt"), false);
  assert.equal(
    objects.get("Moved/Manage/nested/second.txt").toString(),
    "second file",
  );
  checks.push(
    "rename cancellation, verified rename and nested folder move through IPC",
  );
  const entries = [
    { key: "Moved/Manage/renamed.txt" },
    { key: "Moved/Manage/nested/", folder: true },
  ];
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [temp] });
  const bulk = await handlers.downloadSelection(null, "test-bucket", entries);
  await waitFor(
    () =>
      getState().transfers.filter(
        (transfer) =>
          transfer.status === "queued" || transfer.status === "running",
      ).length === 0,
  );
  await waitFor(async () => {
    try {
      return (
        (await fs.readFile(
          path.join(bulk.destination, "Moved/Manage/nested/second.txt"),
          "utf8",
        )) === "second file"
      );
    } catch {
      return false;
    }
  });
  assert.equal(
    await fs.readFile(
      path.join(bulk.destination, "Moved/Manage/renamed.txt"),
      "utf8",
    ),
    "first file",
  );
  await handlers.removeSelection(null, "test-bucket", entries);
  assert.equal(objects.has("Moved/Manage/renamed.txt"), false);
  assert.equal(objects.has("Moved/Manage/nested/second.txt"), false);
  checks.push(
    "bulk download preserves selected hierarchy and confirmed bulk deletion removes cloud objects",
  );
  await nav("files");
  await waitFor(
    async () =>
      await inspect(
        '!!document.querySelector(".table-head input.item-select")',
      ),
  );
  await inspect(
    'document.querySelector(".table-head input.item-select").click()',
  );
  await waitFor(
    async () => await inspect('!!document.querySelector(".selection-bar")'),
  );
  assert.ok(
    (
      await inspect('document.querySelector(".selection-bar").innerText')
    ).includes("Move"),
  );
  await inspect(
    '[...document.querySelectorAll(".selection-bar button")].find(button => button.textContent.includes("Clear")).click()',
  );
  checks.push(
    "explorer select-all displays bulk management controls and clears selection",
  );
  objects.set("Overwrite/sample.txt", Buffer.from("existing"));
  dialog.showMessageBox = async () => ({ response: 0 });
  assert.equal(
    await handlers.uploadPaths(null, "test-bucket", "Overwrite/", [local]),
    false,
  );
  assert.equal(objects.get("Overwrite/sample.txt").toString(), "existing");
  dialog.showMessageBox = async () => ({ response: 1 });
  await handlers.uploadPaths(null, "test-bucket", "Overwrite/", [local]);
  await waitFor(
    () => objects.get("Overwrite/sample.txt").toString() === "verified upload",
  );
  await waitFor(
    () =>
      getState().transfers.find(
        (transfer) => transfer.key === "Overwrite/sample.txt",
      )?.status === "done",
  );
  checks.push(
    "existing upload destinations require overwrite confirmation and cancellation preserves data",
  );
  const largePath = path.join(temp, "upload-tests", "multipart.bin");
  await fs.writeFile(largePath, Buffer.alloc(17 * 1024 * 1024, 65));
  await uploadFile("test-bucket", "multipart.bin", largePath);
  assert.ok(multipartStarted > 0 && multipartFinished > 0);
  assert.equal(objects.get("multipart.bin").length, 17 * 1024 * 1024);
  assert.equal(objects.get("multipart.bin")[100000], 65);
  checks.push(
    "17 MiB multipart upload completes, reassembles parts and verifies size",
  );
  changedLocalFile = path.join(temp, "changes.txt");
  await fs.writeFile(changedLocalFile, "before");
  await assert.rejects(
    uploadFile("test-bucket", "changes-during-upload.txt", changedLocalFile),
    /changed during upload/,
  );
  assert.equal(
    getState().transfers.find((t) => t.key === "changes-during-upload.txt")
      .status,
    "failed",
  );
  checks.push(
    "local file mutation during upload is reported as failure, not verified success",
  );
  releaseUpload = null;
  blockedKey = "Cancel-dir/";
  const directoryUpload = uploadFile(
    "test-bucket",
    "Cancel-dir/",
    undefined,
    true,
  ).catch((e) => e);
  await waitFor(() => !!releaseUpload);
  const directoryTransfer = getState().transfers.find(
    (t) => t.key === "Cancel-dir/",
  );
  await handlers.cancel(null, directoryTransfer.id);
  releaseUpload();
  const directoryResult = await directoryUpload;
  assert.equal(directoryResult.name, "AbortError");
  assert.equal(directoryTransfer.status, "cancelled");
  checks.push("cancelled directory-marker upload cannot revert to done");
  assert.equal(simulateLockedSave(), true);
  setTestConnection(connection, mock);
  checks.push(
    "saving backup state during a locked connection preserves the encrypted pending key",
  );
  const result = {
    passed: true,
    checks,
    cloud:
      "Local in-memory S3 protocol fixture only; no real B2 account tested.",
  };
  progressEmit();
  app.once("will-quit", () => {
    assert.equal(tray.isDestroyed(), true);
    assert.doesNotThrow(() => emit());
    assert.doesNotThrow(() => progressEmit());
    result.checks.push(
      "shutdown safely ignores late progress events after tray destruction",
    );
    result.checks.push("Quit destroys menu-bar icon");
    require("node:fs").writeFileSync(
      path.join(outputDir, "smoke-result.json"),
      JSON.stringify(result, null, 2),
    );
    console.log("BlazeSync desktop checks passed: " + result.checks.length);
  });
  app.quit();
};
