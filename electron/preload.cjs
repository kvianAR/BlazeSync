const { contextBridge, ipcRenderer, webUtils } = require("electron");
const methods = [
  "billing",
  "setBillingBudget",
  "setBillingPaymentDay",
  "openBilling",
  "openPricing",
  "openBackblaze",
  "moveSelection",
  "downloadSelection",
  "removeSelection",
  "folderStats",
  "history",
  "purgeFile",
  "setRefresh",
  "setTheme",
  "setUploadTarget",
  "editConnection",
  "cancelConnectionEdit",
  "downloadFolder",
  "removeFolder",
  "openPage",
  "openKeys",
  "quit",
  "catalog",
  "preview",
  "state",
  "connect",
  "disconnect",
  "list",
  "upload",
  "download",
  "remove",
  "versions",
  "restore",
  "share",
  "mkdir",
  "addBackup",
  "addFolderSync",
  "installFinderSync",
  "openSyncFolder",
  "runBackup",
  "toggleBackup",
  "removeBackup",
  "cancel",
];
const api = {};
for (const method of methods)
  api[method] = (...args) => ipcRenderer.invoke("vault:" + method, ...args);
api.uploadDropped = (files, bucket, prefix) =>
  ipcRenderer.invoke(
    "vault:uploadPaths",
    bucket,
    prefix,
    files.map((file) => webUtils.getPathForFile(file)),
  );
api.onError = (callback) => {
  const fn = (_, message) => callback(message);
  ipcRenderer.on("vault:error", fn);
  return () => ipcRenderer.removeListener("vault:error", fn);
};
api.onUpdate = (callback) => {
  const fn = (_, data) => callback(data);
  ipcRenderer.on("vault:update", fn);
  return () => ipcRenderer.removeListener("vault:update", fn);
};
api.onNavigate = (callback) => {
  const fn = (_, page) => callback(page);
  ipcRenderer.on("vault:navigate", fn);
  return () => ipcRenderer.removeListener("vault:navigate", fn);
};
contextBridge.exposeInMainWorld("vault", api);
