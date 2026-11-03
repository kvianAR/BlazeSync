import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Cloud,
  Folder,
  File,
  ArrowUpRight,
  Upload,
  Download,
  Search,
  RefreshCw,
  Plus,
  ChevronRight,
  HardDrive,
  Settings,
  History,
  ArrowLeft,
  Link,
  Trash2,
  Check,
  AlertCircle,
  ArrowDownUp,
  ShieldCheck,
  Clock,
  Play,
  Pause,
  X,
  LoaderCircle,
  Image as ImageIcon,
  FileText,
  Moon,
  Sun,
  Lock,
  CircleCheck,
  CloudOff,
  Wallet,
  Pencil,
  FolderInput,
} from "lucide-react";
import "./style.css";
import "./quiet.css";
import logo from "./logo.svg";
import Billing from "./Billing.jsx";
import { uniqueBy, refreshPages } from "./listing-data.mjs";
const api = window.vault;
const bytes = (n) => {
  if (!n) return "0 B";
  const i = Math.min(4, Math.floor(Math.log(n) / Math.log(1000)));
  return (
    (n / 1000 ** i).toFixed(i ? 1 : 0) + " " + ["B", "KB", "MB", "GB", "TB"][i]
  );
};
const date = (s) =>
  s
    ? new Date(s).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
function App() {
  const fileRequest = useRef(0),
    catalogRequest = useRef(0),
    fileLoading = useRef(false),
    metricsRequest = useRef(0),
    versionRequest = useRef(0),
    previewRequest = useRef(0);
  const [state, setState] = useState({ transfers: [], jobs: [], events: [] }),
    [selected, setSelected] = useState([]),
    [manageEntries, setManageEntries] = useState([]),
    [manageMode, setManageMode] = useState("move"),
    [newName, setNewName] = useState(""),
    [destinationBucket, setDestinationBucket] = useState(""),
    [destinationPrefix, setDestinationPrefix] = useState(""),
    [managing, setManaging] = useState(false),
    [metrics, setMetrics] = useState(null),
    [metricsBusy, setMetricsBusy] = useState(false),
    [metricsError, setMetricsError] = useState(""),
    [fileView, setFileView] = useState("current"),
    [historyData, setHistoryData] = useState({ entries: [] }),
    [historyBusy, setHistoryBusy] = useState(false),
    [historyError, setHistoryError] = useState(""),
    [lastChecked, setLastChecked] = useState(null),
    [listingError, setListingError] = useState(""),
    [page, setPage] = useState("files"),
    [buckets, setBuckets] = useState([]),
    [bucket, setBucket] = useState(""),
    [prefix, setPrefix] = useState(""),
    [listing, setListing] = useState({ files: [], folders: [] }),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [modal, setModal] = useState(null),
    [versionData, setVersionData] = useState(null),
    [versionBucket, setVersionBucket] = useState(""),
    [versionKey, setVersionKey] = useState(""),
    [folderName, setFolderName] = useState(""),
    [interval, setIntervalValue] = useState(60),
    [catalog, setCatalog] = useState({ files: [] }),
    [catalogBusy, setCatalogBusy] = useState(false),
    [album, setAlbum] = useState(""),
    [sort, setSort] = useState("newest"),
    [previewFile, setPreviewFile] = useState(null),
    [previewUrl, setPreviewUrl] = useState(""),
    [dragging, setDragging] = useState(false),
    [needsBucket, setNeedsBucket] = useState(false),
    [form, setForm] = useState({
      endpoint: "",
      keyId: "",
      applicationKey: "",
      bucket: "",
    });
  const act = async (fn) => {
    setError("");
    try {
      return await fn();
    } catch (e) {
      if (e.message.includes("BUCKET_NAME_REQUIRED")) setNeedsBucket(true);
      setError(
        e.message
          .replace(/^Error invoking remote method '[^']+': Error: /, "")
          .replace("BUCKET_NAME_REQUIRED: ", ""),
      );
    }
  };
  useEffect(() => {
    if (!api) {
      setError(
        "Open BlazeSync.app to connect your account. This browser view is a visual preview.",
      );
      return;
    }
    api
      .state()
      .then(setState)
      .catch((e) => setError(e.message));
    return api.onUpdate(setState);
  }, []);
  useEffect(
    () =>
      api?.onNavigate((p) => {
        setPage(p);
        setSearch("");
      }),
    [],
  );
  useEffect(() => {
    let cancelled = false;
    if (!api || !state.connected) {
      setBuckets([]);
      setBucket("");
      setListing({ files: [], folders: [] });
      return;
    }
    act(async () => {
      const r = await api.list();
      if (cancelled) return;
      setBuckets(r.buckets);
      setPrefix("");
      setModal(null);
      setBucket((b) =>
        r.buckets.some((x) => x.Name === b) ? b : r.buckets[0]?.Name || "",
      );
    });
    return () => {
      cancelled = true;
    };
  }, [state.connected, state.connectionId]);
  const loadSizes = async (force = false) => {
    const request = ++metricsRequest.current;
    if (!bucket || !state.connected) return;
    setMetricsBusy(true);
    try {
      const result = await api.folderStats(bucket, prefix, force);
      if (request !== metricsRequest.current) return;
      setMetrics(result);
      setMetricsError("");
    } catch (error) {
      if (request === metricsRequest.current) setMetricsError(error.message);
    } finally {
      if (request === metricsRequest.current) setMetricsBusy(false);
    }
  };
  const load = async (more = false) => {
    const request = ++fileRequest.current;
    if (!bucket) return;
    fileLoading.current = true;
    setBusy(true);
    try {
      const r = more
        ? await api.list(bucket, prefix, listing.next)
        : await refreshPages(
            (token) => api.list(bucket, prefix, token),
            listing.files.length + listing.folders.length,
          );
      if (request !== fileRequest.current) return;
      setListingError("");
      setLastChecked(Date.now());
      setListing((old) =>
        more
          ? {
              ...r,
              files: uniqueBy([...old.files, ...r.files], (f) => f.key),
              folders: [...new Set([...old.folders, ...r.folders])],
            }
          : r,
      );
      loadSizes(!more);
    } catch (error) {
      if (request !== fileRequest.current) return;
      if (request === fileRequest.current) setListingError(error.message);
      throw error;
    } finally {
      if (request === fileRequest.current) {
        fileLoading.current = false;
        setBusy(false);
      }
    }
  };
  useEffect(() => {
    fileRequest.current++;
    metricsRequest.current++;
    setMetrics(null);
    setMetricsError("");
    setMetricsBusy(false);
    fileLoading.current = false;
    setBusy(false);
    setSearch("");
    setListing({ files: [], folders: [] });
    setListingError("");
    setLastChecked(null);
    if (state.connected && bucket) act(() => load());
  }, [bucket, prefix, state.connected, state.connectionId]);
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(""), 6500);
      return () => clearTimeout(id);
    }
  }, [toast]);
  const active = state.transfers.filter((t) =>
    !t.batch && ["running", "queued"].includes(t.status),
  ).length;
  const pending = state.transfers.filter(
    (t) =>
      t.type === "upload" &&
      !t.batch &&
      t.bucket === bucket &&
      ["queued", "running"].includes(t.status),
  );
  const pendingByKey = new Map([...pending].reverse().map((t) => [t.key, t]));
  const fileRows = [
    ...listing.files.filter((f) => !pendingByKey.has(f.key)),
    ...[...pendingByKey.values()]
      .filter(
        (t) =>
          !t.directory &&
          t.key.startsWith(prefix) &&
          !t.key.slice(prefix.length).includes("/"),
      )
      .map((t) => ({ key: t.key, size: t.size, modified: null, transfer: t })),
  ];
  const pendingFolders = pending
    .filter(
      (t) =>
        t.key.startsWith(prefix) && t.key.slice(prefix.length).includes("/"),
    )
    .map((t) => prefix + t.key.slice(prefix.length).split("/")[0] + "/");
  const total = metrics?.bytes;
  const shown = fileRows.filter((f) =>
    f.key.slice(prefix.length).toLowerCase().includes(search.toLowerCase()),
  );
  const folders = [...new Set([...listing.folders, ...pendingFolders])].filter(
    (f) => f.slice(prefix.length).toLowerCase().includes(search.toLowerCase()),
  );
  const selectedId = (entry) => (entry.folder ? "d:" : "f:") + entry.key;
  const selectedIds = new Set(selected.map(selectedId));
  const selectable = [
    ...folders
      .filter((key) => listing.folders.includes(key))
      .map((key) => ({ key, folder: true })),
    ...shown
      .filter((file) => !file.transfer)
      .map((file) => ({ key: file.key, folder: false })),
  ];
  const allSelected =
    selectable.length > 0 &&
    selectable.every((entry) => selectedIds.has(selectedId(entry)));
  function toggleSelected(entry) {
    setSelected((old) =>
      old.some((value) => selectedId(value) === selectedId(entry))
        ? old.filter((value) => selectedId(value) !== selectedId(entry))
        : [...old, entry],
    );
  }
  function openManage(mode) {
    if (!selected.length) return;
    setManageEntries([...selected]);
    setManageMode(mode);
    setNewName(selected[0].key.replace(/\/$/, "").split("/").pop());
    setDestinationBucket(bucket);
    setDestinationPrefix("");
    setModal("manage");
  }
  async function submitManagement(event) {
    event.preventDefault();
    setManaging(true);
    try {
      const source = manageEntries[0].key.replace(/\/$/, "");
      const parent = source.includes("/")
        ? source.slice(0, source.lastIndexOf("/") + 1)
        : "";
      const result = await api.moveSelection(
        bucket,
        manageEntries,
        manageMode === "rename" ? bucket : destinationBucket,
        manageMode === "rename" ? parent : destinationPrefix,
        manageMode === "rename" ? newName : undefined,
      );
      if (result) {
        setModal(null);
        setSelected([]);
        setToast(
          manageMode === "rename"
            ? "Item renamed in Backblaze."
            : "Selected items moved in Backblaze.",
        );
      }
    } catch (failure) {
      setError(failure.message);
    } finally {
      setManaging(false);
    }
  }
  useEffect(
    () => setSelected([]),
    [bucket, prefix, fileView, state.connectionId],
  );
  const versions = async (key, more = false, sourceBucket = bucket) => {
    const request = ++versionRequest.current;
    const r = await api.versions(
      sourceBucket,
      key,
      more ? versionData?.next : undefined,
    );
    if (request !== versionRequest.current) return;
    setVersionData((old) =>
      more
        ? {
            ...r,
            versions: [...old.versions, ...r.versions],
            markers: [...old.markers, ...r.markers],
          }
        : r,
    );
    setVersionBucket(sourceBucket);
    setVersionKey(key);
    setModal("versions");
  };
  const loadCatalog = async (more = false) => {
    const request = ++catalogRequest.current;
    if (!bucket || !state.connected) return;
    setCatalogBusy(true);
    try {
      const r = more
        ? await api.catalog(bucket, catalog.next)
        : await refreshPages(
            (token) => api.catalog(bucket, token),
            catalog.files.length,
          );
      if (request !== catalogRequest.current) return;
      setCatalog((old) =>
        more
          ? { ...r, files: uniqueBy([...old.files, ...r.files], (f) => f.key) }
          : r,
      );
    } finally {
      if (request === catalogRequest.current) setCatalogBusy(false);
    }
  };
  useEffect(() => {
    catalogRequest.current++;
    setCatalog({ files: [] });
    setAlbum("");
    setSearch("");
    if (state.connected && bucket && ["photos", "library"].includes(page))
      act(() => loadCatalog());
  }, [bucket, page, state.connected, state.connectionId]);
  const category = catalog.files.filter((f) =>
    page === "photos" ? f.photo : !f.photo,
  );
  const albums = [
    ...new Set(
      category.map((f) =>
        f.key.includes("/")
          ? f.key.slice(0, f.key.lastIndexOf("/"))
          : "(bucket root)",
      ),
    ),
  ].sort();
  const library = category
    .filter(
      (f) =>
        (!album ||
          (f.key.includes("/")
            ? f.key.slice(0, f.key.lastIndexOf("/"))
            : "(bucket root)") === album) &&
        f.key.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.key.localeCompare(b.key)
        : sort === "size"
          ? b.size - a.size
          : new Date(b.modified) - new Date(a.modified),
    );
  const preview = async (f) => {
    const request = ++previewRequest.current;
    setPreviewFile({ ...f, bucket });
    setPreviewUrl("");
    setModal("preview");
    if (f.preview) {
      const url = await api.preview(bucket, f.key);
      if (request === previewRequest.current) setPreviewUrl(url);
    }
  };
  const openSettings = () => {
    setForm((f) => ({
      ...f,
      endpoint: state.connection?.endpoint || f.endpoint,
      bucket: state.connection?.bucket || "",
    }));
    setPage("settings");
  };
  useEffect(() => api?.onError(setError), []);
  useEffect(() => {
    document.documentElement.dataset.theme = state.dark ? "dark" : "light";
  }, [state.dark]);
  useEffect(() => {
    if (state.connected && bucket)
      act(() => api.setUploadTarget(bucket, prefix));
  }, [bucket, prefix, state.connected, state.connectionId]);
  useEffect(() => {
    if (state.connected && bucket) {
      act(() => load());
      if (["photos", "library"].includes(page)) act(() => loadCatalog());
    }
  }, [state.revision]);
  const historyRequest = useRef(0);
  const loadHistory = async (more = false) => {
    const request = ++historyRequest.current;
    setHistoryBusy(true);
    try {
      const result = await api.history(
        bucket,
        prefix,
        more ? historyData.next : undefined,
      );
      if (request !== historyRequest.current) return;
      setHistoryData((old) =>
        more
          ? { ...result, entries: [...old.entries, ...result.entries] }
          : result,
      );
      setHistoryError("");
    } catch (error) {
      if (request === historyRequest.current) setHistoryError(error.message);
    } finally {
      if (request === historyRequest.current) setHistoryBusy(false);
    }
  };
  useEffect(() => {
    historyRequest.current++;
    setHistoryData({ entries: [] });
    setHistoryError("");
    if (state.connected && bucket && fileView === "history") loadHistory();
  }, [
    bucket,
    prefix,
    fileView,
    state.revision,
    state.connected,
    state.connectionId,
  ]);
  useEffect(() => {
    if (!state.connected || !bucket) return;
    const refresh = () => {
      if (!document.hidden && !fileLoading.current) {
        load().catch(() => {});
        if (fileView === "history") loadHistory();
        if (["library", "photos"].includes(page)) loadCatalog().catch(() => {});
      }
    };
    const interval =
      state.refreshSeconds === 0
        ? null
        : setInterval(refresh, (state.refreshSeconds || 15) * 1000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [state.connected, bucket, prefix, page, fileView, state.refreshSeconds]);
  const sortedHistory = historyData.entries.filter((v) =>
    v.key.toLowerCase().includes(search.toLowerCase()),
  );
  useEffect(() => {
    versionRequest.current++;
    previewRequest.current++;
    setModal(null);
  }, [bucket, prefix, state.connectionId]);
  function closeModal() {
    versionRequest.current++;
    previewRequest.current++;
    setModal(null);
  }
  const drop = (event) => {
    event.preventDefault();
    setDragging(false);
    const files = [...event.dataTransfer.files];
    if (!files.length) return;
    if (!bucket || !state.connected) {
      setError("Connect and select a bucket before dropping files.");
      return;
    }
    act(async () => {
      const result = await api.uploadDropped(files, bucket, prefix);
      if (result)
        setToast(
          result.files +
            " new/changed files queued · " +
            (result.skipped || 0) +
            " unchanged items skipped",
        );
    });
  };
  return (
    <div
      className="shell"
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
      }}
      onDrop={drop}
    >
      {dragging && (
        <div className="drop-overlay">
          <Upload size={40} />
          <h2>Drop files or folders to upload</h2>
          <p>
            {bucket
              ? bucket + "/" + prefix
              : "Connect and select a bucket first"}
          </p>
        </div>
      )}
      <aside>
        <div className="brand">
          <img className="brand-logo" src={logo} alt="BlazeSync logo" />
          <div>
            BlazeSync<small>YOUR PERSONAL CLOUD</small>
          </div>
        </div>
        <div className="workspace">
          <span
            className={
              "dot " +
              (state.connected && state.health === "online" ? "green" : "")
            }
          />
          <div>
            Personal workspace
            <small>
              {state.connected
                ? state.health === "offline"
                  ? "Offline · connection saved"
                  : "Backblaze B2 connected"
                : "Ready to connect"}
            </small>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {[
            ["files", Folder, "All files"],
            ["library", FileText, "Files"],
            ["photos", ImageIcon, "Photos"],
            ["backups", ShieldCheck, "Folder sync & backups"],
            ["billing", Wallet, "Storage & billing"],
            ["transfers", ArrowDownUp, "Transfers"],
            ["activity", History, "Activity"],
          ].map(([id, Icon, label]) => (
            <button
              aria-current={page === id ? "page" : undefined}
              className={page === id ? "selected" : ""}
              key={id}
              onClick={() => setPage(id)}
            >
              <Icon size={18} />
              {label}
              {id === "transfers" && active > 0 && (
                <span className="badge">{active}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-label bucket-label">
          STORAGE <span>{buckets.length}</span>
        </div>
        <div className="buckets">
          {buckets.length ? (
            buckets.map((b) => (
              <button
                key={b.Name}
                className={bucket === b.Name ? "bucket-current" : ""}
                onClick={() => {
                  setBucket(b.Name);
                  setPrefix("");
                  setPage("files");
                }}
              >
                <HardDrive size={16} />
                <span>{b.Name}</span>
              </button>
            ))
          ) : (
            <p>
              Your buckets will appear
              <br />
              after you connect.
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="private">
            <ShieldCheck size={17} />
            <div>
              Private by design<small>Keys protected on your Mac</small>
            </div>
          </div>
          <button
            onClick={openSettings}
            className={page === "settings" ? "selected" : ""}
          >
            <Settings size={18} />
            Connection settings
          </button>
        </div>
      </aside>
      <div className="main">
        <header>
          <span>
            Workspace <ChevronRight size={14} />{" "}
            <b>
              {
                {
                  files: "All files",
                  library: "Files",
                  photos: "Photos",
                  backups: "Folder backups",
                  transfers: "Transfers",
                  activity: "Activity",
                  settings: "Connection settings",
                  billing: "Storage & billing",
                }[page]
              }
            </b>
          </span>
          <div className="header-right">
            <button
              title="Toggle dark mode"
              onClick={() =>
                act(() => api.setTheme(state.dark ? "light" : "dark"))
              }
            >
              {state.dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <span
              className={
                "dot " +
                (state.connected && state.health === "online" ? "green" : "")
              }
            />
            {state.connected
              ? {
                  online: "Connected to B2",
                  offline: "Offline · auto reconnect",
                  checking: "Checking connection…",
                  "key-error": "Key needs attention",
                  attention: "Check access",
                }[state.health] || "Connection saved"
              : "Not connected"}
            <div className="avatar">BS</div>
          </div>
        </header>
        <main>
          {error && (
            <div className="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {toast && (
            <div className="toast">
              <Check size={17} />
              {toast}
            </div>
          )}
          {state.cloudLimit && (
            <div className="alert" role="alert">
              <AlertCircle size={18} />
              <span>{state.cloudLimit}</span>
              <button onClick={() => act(() => api.openCaps())}>
                Backblaze Caps & Alerts
              </button>
            </div>
          )}
          {state.fileOperation && (
            <div className="info-strip" role="status">
              <LoaderCircle size={18} className="spin" />
              {state.fileOperation.label}
              {state.fileOperation.total > 0
                ? ` · ${state.fileOperation.completed}/${state.fileOperation.total}`
                : ""}
            </div>
          )}
          {page === "billing" && <Billing api={api} state={state} />}
          {page === "files" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR CLOUD WORKSPACE</div>
                  <h1>My files</h1>
                  <p>
                    A direct view of your Backblaze bucket. Files, folders and
                    history, together.
                  </p>
                </div>
                <button
                  className="primary"
                  disabled={!state.connected || !bucket}
                  onClick={() => act(() => api.upload(bucket, prefix))}
                >
                  <Upload size={17} />
                  Upload files / folders
                </button>
              </div>
              {state.connected && (
                <div className="sync-status" role="status">
                  <span
                    className={"sync-symbol " + (listingError ? "warning" : "")}
                  >
                    <RefreshCw size={16} className={busy ? "spin" : ""} />
                  </span>
                  <div>
                    <b>
                      {listingError
                        ? "Could not refresh cloud files"
                        : busy
                          ? "Checking Backblaze…"
                          : lastChecked
                            ? "Cloud listing checked"
                            : "Checking your bucket"}
                    </b>
                    <small>
                      {listingError
                        ? "Your last successful list is kept. Check connection and refresh."
                        : lastChecked
                          ? `Checked ${date(lastChecked)} · ${state.refreshSeconds === 0 ? "Manual refresh" : `Refresh every ${state.refreshSeconds || 15}s`}`
                          : "Current files and version history are separate views."}
                    </small>
                  </div>
                  <button
                    onClick={() =>
                      act(async () => {
                        await load();
                        if (fileView === "history") await loadHistory();
                      })
                    }
                    disabled={busy}
                  >
                    Refresh now
                  </button>
                </div>
              )}
              <div className="stats">
                <Stat
                  icon={HardDrive}
                  label="Current folder size"
                  value={
                    metrics
                      ? bytes(total)
                      : metricsError
                        ? "Unavailable"
                        : "Calculating…"
                  }
                  note={
                    metricsError
                      ? "Size check failed · Refresh to retry"
                      : metricsBusy
                        ? "Calculating all subfolders…"
                        : metrics
                          ? `${metrics.files} current file${metrics.files === 1 ? "" : "s"} · Includes all subfolders`
                          : "Scanning current files and all subfolders"
                  }
                />
                <Stat
                  icon={Folder}
                  label="Visible items"
                  value={String(
                    fileRows.length +
                      new Set([...listing.folders, ...pendingFolders]).size,
                  )}
                  note={bucket || "Choose a bucket to get started"}
                />
                <Stat
                  icon={ArrowDownUp}
                  label="Active transfers"
                  value={String(active).padStart(2, "0")}
                  note="Uploads and downloads"
                />
                <Stat
                  icon={ShieldCheck}
                  label="Folder backups"
                  value={String(state.jobs.length).padStart(2, "0")}
                  note="Scheduled while this app is open"
                />
              </div>
              {!state.connected ? (
                <div className="welcome">
                  <div className="welcome-icon">
                    <img src={logo} alt="BlazeSync logo" />
                  </div>
                  <span className="pill">YOUR CLOUD, YOUR SPACE</span>
                  <h2>Make room for what matters.</h2>
                  <p>
                    Connect your Backblaze B2 account to browse files,
                    <br />
                    move your projects, and keep your folders backed up.
                  </p>
                  <button className="primary" onClick={openSettings}>
                    Connect Backblaze B2 <ArrowUpRight size={17} />
                  </button>
                  <small>No files are uploaded until you choose them.</small>
                </div>
              ) : (
                <div className="file-panel">
                  <div className="file-toolbar">
                    <div className="breadcrumbs">
                      <button onClick={() => setPrefix("")}>
                        <HardDrive size={16} />
                        {bucket || "Select a bucket"}
                      </button>
                      {prefix
                        .split("/")
                        .filter(Boolean)
                        .map((part, i, parts) => (
                          <React.Fragment key={i}>
                            <ChevronRight size={14} />
                            <button
                              onClick={() =>
                                setPrefix(parts.slice(0, i + 1).join("/") + "/")
                              }
                            >
                              {part}
                            </button>
                          </React.Fragment>
                        ))}
                    </div>
                    <div className="toolbar-actions">
                      <button
                        title="Download current folder"
                        onClick={() =>
                          act(() => api.downloadFolder(bucket, prefix))
                        }
                      >
                        <Download size={16} />
                        Download folder
                      </button>
                      <button
                        title="Refresh"
                        disabled={busy}
                        onClick={() => act(() => load())}
                      >
                        <RefreshCw size={17} className={busy ? "spin" : ""} />
                      </button>
                      <button
                        disabled={!bucket}
                        onClick={() => {
                          setFolderName("");
                          setModal("folder");
                        }}
                      >
                        <Plus size={16} />
                        New folder
                      </button>
                    </div>
                  </div>
                  <div
                    className="view-tabs"
                    role="tablist"
                    aria-label="Cloud file view"
                  >
                    <button
                      role="tab"
                      aria-selected={fileView === "current"}
                      className={fileView === "current" ? "active" : ""}
                      onClick={() => setFileView("current")}
                    >
                      <Folder size={16} />
                      Current files
                    </button>
                    <button
                      role="tab"
                      aria-selected={fileView === "history"}
                      className={fileView === "history" ? "active" : ""}
                      onClick={() => setFileView("history")}
                    >
                      <History size={16} />
                      Versions & deleted
                    </button>
                    <span>Backblaze B2 · {bucket}</span>
                  </div>
                  {fileView === "current" && selected.length > 0 && (
                    <div className="selection-bar">
                      <b>{selected.length} selected</b>
                      <button
                        disabled={
                          !!state.fileOperation || selected.length !== 1
                        }
                        onClick={() => openManage("rename")}
                      >
                        <Pencil size={15} />
                        Rename
                      </button>
                      <button
                        disabled={!!state.fileOperation}
                        onClick={() => openManage("move")}
                      >
                        <FolderInput size={15} />
                        Move
                      </button>
                      <button
                        disabled={!!state.fileOperation}
                        onClick={() =>
                          act(async () => {
                            const result = await api.downloadSelection(
                              bucket,
                              selected,
                            );
                            if (result) {
                              setToast(
                                `Queued ${result.files} files for download.`,
                              );
                              setSelected([]);
                            }
                          })
                        }
                      >
                        <Download size={15} />
                        Download
                      </button>
                      <button
                        disabled={!!state.fileOperation}
                        onClick={() =>
                          act(async () => {
                            const result = await api.removeSelection(
                              bucket,
                              selected,
                            );
                            if (result) {
                              setToast(
                                `Deleted ${result.deleted} current objects.`,
                              );
                              setSelected([]);
                            }
                          })
                        }
                      >
                        <Trash2 size={15} />
                        Delete
                      </button>
                      <button onClick={() => setSelected([])}>Clear</button>
                    </div>
                  )}
                  <div className="search-row">
                    <div className="search">
                      <Search size={17} />
                      <input
                        placeholder="Search this folder…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <span>
                      {fileView === "history"
                        ? sortedHistory.length
                        : folders.length + shown.length}{" "}
                      {fileView === "history" ? "history entries" : "items"}
                    </span>
                  </div>
                  {fileView === "history" ? (
                    <div className="history-panel">
                      <div className="history-notice">
                        <History size={18} />
                        <p>
                          Backblaze keeps old versions and delete markers. A
                          hidden file can remain in the web console until its
                          stored versions are permanently deleted.
                        </p>
                      </div>
                      {historyError && (
                        <div className="alert">
                          History could not be loaded. {historyError}
                        </div>
                      )}
                      <div className="table-head">
                        <span>Name / version</span>
                        <span>Size</span>
                        <span>State</span>
                        <span>Actions</span>
                      </div>
                      {sortedHistory.map((v) => (
                        <div
                          className="file-row history-row"
                          key={v.key + v.id + v.deleted}
                        >
                          <div className="file-name">
                            <span
                              className={
                                "file-icon " + (v.deleted ? "deleted-icon" : "")
                              }
                            >
                              <History size={18} />
                            </span>
                            <div>
                              <strong title={v.key}>{v.key}</strong>
                              <small>
                                {date(v.modified)} · {v.id.slice(0, 14)}…
                              </small>
                            </div>
                          </div>
                          <span>{v.deleted ? "—" : bytes(v.size)}</span>
                          <span
                            className={
                              "status-chip " + (v.deleted ? "deleted" : "")
                            }
                          >
                            {v.deleted
                              ? v.latest
                                ? "Hidden / deleted"
                                : "Delete marker"
                              : v.latest
                                ? "Current version"
                                : "Older version"}
                          </span>
                          <div className="row-actions">
                            {!v.deleted && (
                              <button
                                title="View and restore versions"
                                onClick={() => act(() => versions(v.key))}
                              >
                                <History size={16} />
                              </button>
                            )}
                            <button
                              title="Permanently delete all versions of this file"
                              onClick={() =>
                                act(async () => {
                                  const result = await api.purgeFile(
                                    bucket,
                                    v.key,
                                  );
                                  if (result) {
                                    setToast(
                                      "Backblaze confirmed all stored versions were deleted.",
                                    );
                                    await loadHistory();
                                    await load();
                                  }
                                })
                              }
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                      {historyBusy && (
                        <div className="empty">
                          <LoaderCircle className="spin" />
                          Loading Backblaze history…
                        </div>
                      )}
                      {!historyBusy &&
                        !historyError &&
                        !sortedHistory.length && (
                          <Empty
                            icon={History}
                            title="No stored versions found"
                            text="Backblaze returned no history for this folder and filter."
                          />
                        )}
                      {historyData.next && (
                        <button onClick={() => loadHistory(true)}>
                          Load more history
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="file-table">
                      <div className="table-head">
                        <span className="selection-heading">
                          <input
                            className="item-select"
                            type="checkbox"
                            aria-label="Select all shown files and folders"
                            checked={allSelected}
                            onChange={() =>
                              setSelected(allSelected ? [] : selectable)
                            }
                          />
                          Name
                        </span>
                        <span>Size</span>
                        <span>Last modified</span>
                        <span>Actions</span>
                      </div>
                      {prefix && (
                        <div
                          className="file-row parent"
                          onClick={() =>
                            setPrefix(
                              prefix.split("/").slice(0, -2).join("/") +
                                (prefix.split("/").length > 2 ? "/" : ""),
                            )
                          }
                        >
                          <span>
                            <ArrowLeft size={17} />
                            Parent folder
                          </span>
                        </div>
                      )}
                      {folders.map((f) => (
                        <div
                          className="file-row folder"
                          key={f}
                          onDoubleClick={() => setPrefix(f)}
                        >
                          <div className="file-name">
                            <input
                              className="item-select"
                              type="checkbox"
                              aria-label={"Select folder " + f}
                              disabled={
                                !listing.folders.includes(f) ||
                                !!state.fileOperation
                              }
                              checked={selectedIds.has("d:" + f)}
                              onChange={() =>
                                toggleSelected({ key: f, folder: true })
                              }
                            />
                            <button
                              className="file-name"
                              onClick={() => setPrefix(f)}
                            >
                              <span className="file-icon folder-icon">
                                <Folder size={20} />
                              </span>
                              {f.slice(prefix.length).replace(/\/$/, "")}
                            </button>
                          </div>
                          <span
                            className="folder-size"
                            title={
                              metricsError ||
                              "Total current file size, including nested subfolders"
                            }
                          >
                            {metrics?.folders[f]
                              ? bytes(metrics.folders[f].bytes)
                              : metricsBusy
                                ? "Calculating…"
                                : pendingFolders.includes(f) &&
                                    !listing.folders.includes(f)
                                  ? "Uploading…"
                                  : metricsError
                                    ? "Unavailable"
                                    : metrics
                                      ? "0 B"
                                      : "Calculating…"}
                            {metrics?.folders[f] && (
                              <small>
                                {metrics.folders[f].files} file
                                {metrics.folders[f].files === 1 ? "" : "s"}
                              </small>
                            )}
                          </span>
                          <span>Folder</span>
                          <div className="row-actions">
                            <button
                              title="Download complete folder"
                              onClick={() =>
                                act(() => api.downloadFolder(bucket, f))
                              }
                            >
                              <Download size={15} />
                            </button>
                            <button
                              title="Delete complete folder"
                              onClick={() =>
                                act(() => api.removeFolder(bucket, f))
                              }
                            >
                              <Trash2 size={15} />
                            </button>
                            <button
                              title="Open folder"
                              onClick={() => setPrefix(f)}
                            >
                              <ChevronRight size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                      {shown.map((f) => (
                        <div className="file-row" key={f.key}>
                          <span className="file-name">
                            <input
                              className="item-select"
                              type="checkbox"
                              aria-label={"Select file " + f.key}
                              disabled={!!f.transfer || !!state.fileOperation}
                              checked={selectedIds.has("f:" + f.key)}
                              onChange={() =>
                                toggleSelected({ key: f.key, folder: false })
                              }
                            />
                            <span
                              className={
                                "file-icon " +
                                (/\.(png|jpg|webp|svg)$/i.test(f.key)
                                  ? "image-icon"
                                  : "")
                              }
                            >
                              <File size={19} />
                            </span>
                            <span title={f.key}>
                              {f.key.slice(prefix.length)}
                            </span>
                          </span>
                          <span>{bytes(f.size)}</span>
                          <span>
                            {f.transfer ? (
                              <>
                                <small>
                                  {f.transfer.status === "running"
                                    ? "Uploading"
                                    : f.transfer.status}{" "}
                                  · {bytes(f.transfer.speed || 0)}/s
                                </small>
                                <div className="progress">
                                  <i
                                    style={{
                                      width:
                                        (f.transfer.size
                                          ? Math.min(
                                              100,
                                              (f.transfer.loaded /
                                                f.transfer.size) *
                                                100,
                                            )
                                          : 0) + "%",
                                    }}
                                  />
                                </div>
                              </>
                            ) : (
                              date(f.modified)
                            )}
                          </span>
                          <div className="row-actions">
                            <button
                              title="Download"
                              disabled={!!f.transfer}
                              onClick={() =>
                                act(() => api.download(bucket, f.key, f.size))
                              }
                            >
                              <Download size={15} />
                            </button>
                            <button
                              title="Version history"
                              onClick={() => act(() => versions(f.key))}
                            >
                              <History size={15} />
                            </button>
                            <button
                              title="Copy private link · 1 hour"
                              onClick={() =>
                                act(async () =>
                                  setToast(await api.share(bucket, f.key)),
                                )
                              }
                            >
                              <Link size={15} />
                            </button>
                            <button
                              title="Delete file"
                              disabled={!!f.transfer}
                              className="danger-icon"
                              onClick={() =>
                                act(async () => {
                                  if (await api.remove(bucket, f.key))
                                    await load();
                                })
                              }
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                      ))}
                      {!busy &&
                        !listingError &&
                        !folders.length &&
                        !shown.length && (
                          <div className="empty">
                            <Folder size={32} />
                            <h3>
                              {search
                                ? "No matching files"
                                : "No current files in this folder"}
                            </h3>
                            <p>
                              {search
                                ? "Search covers the currently loaded folder."
                                : "Upload files, or open Versions & deleted to check Backblaze history."}
                            </p>
                            {!search && (
                              <button onClick={() => setFileView("history")}>
                                <History size={16} />
                                View versions & deleted
                              </button>
                            )}
                          </div>
                        )}
                      {busy && (
                        <div className="empty">
                          <LoaderCircle className="spin" />
                          Loading your files…
                        </div>
                      )}
                    </div>
                  )}
                  <div className="table-footer">
                    <span>
                      {fileView === "history"
                        ? "History comes directly from Backblaze. Load all pages for complete results."
                        : "Current files exclude older versions and delete markers. Search covers loaded items."}
                    </span>
                    {fileView === "current" && listing.next && (
                      <button onClick={() => act(() => load(true))}>
                        Load more
                      </button>
                    )}
                  </div>
                </div>
              )}
              <div className="bottom-note">
                <ShieldCheck size={16} />
                <span>Your files stay in your B2 account.</span>
                <span>
                  Backup and sync have different jobs. This version provides
                  one-way backups.
                </span>
              </div>
            </>
          )}
          {["library", "photos"].includes(page) && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {page === "photos"
                      ? "MOMENTS, WELL KEPT"
                      : "EVERY FILE HAS A PLACE"}
                  </div>
                  <h1>
                    {page === "photos"
                      ? "Your photos. Beautifully sorted."
                      : "Find exactly what you need."}
                  </h1>
                  <p>
                    {page === "photos"
                      ? "Photos grouped by their existing cloud folders. Originals stay untouched."
                      : "Documents, videos, archives and other non-photo files across this bucket."}
                  </p>
                </div>
                <button
                  disabled={!state.connected || !bucket || catalogBusy}
                  onClick={() => act(() => loadCatalog())}
                >
                  <RefreshCw size={16} className={catalogBusy ? "spin" : ""} />
                  Refresh
                </button>
              </div>
              {!state.connected ? (
                <section className="card">
                  <Empty
                    icon={page === "photos" ? ImageIcon : FileText}
                    title="Connect your cloud first"
                    text="Your real files will appear here after connecting Backblaze B2."
                  />
                  <button className="primary" onClick={openSettings}>
                    Connect Backblaze B2
                  </button>
                </section>
              ) : (
                <>
                  <div className="library-controls">
                    <select
                      aria-label="Bucket"
                      value={bucket}
                      onChange={(e) => setBucket(e.target.value)}
                    >
                      {buckets.map((b) => (
                        <option key={b.Name}>{b.Name}</option>
                      ))}
                    </select>
                    <div className="search">
                      <Search size={16} />
                      <input
                        aria-label="Search library"
                        placeholder="Search loaded file names and folders…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <select
                      aria-label="Folder filter"
                      value={album}
                      onChange={(e) => setAlbum(e.target.value)}
                    >
                      <option value="">All folders</option>
                      {albums.map((a) => (
                        <option key={a}>{a}</option>
                      ))}
                    </select>
                    <select
                      aria-label="Sort files"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="newest">Newest first</option>
                      <option value="name">Name A–Z</option>
                      <option value="size">Largest first</option>
                    </select>
                  </div>
                  <div className="catalog-summary">
                    <span>
                      <b>{library.length}</b>{" "}
                      {page === "photos" ? "photos" : "files"} shown ·{" "}
                      {bytes(library.reduce((n, f) => n + f.size, 0))}
                    </span>
                    <span>
                      {catalog.files.length} objects scanned ·{" "}
                      {catalog.next
                        ? "Partial results — load more below"
                        : "Bucket scan complete"}
                    </span>
                  </div>
                  {page === "photos" ? (
                    <div className="photo-grid">
                      {library.map((f) => (
                        <article className="photo-card" key={f.key}>
                          <button
                            className="photo-tile"
                            onClick={() => act(() => preview(f))}
                          >
                            <ImageIcon size={38} />
                            <span>{f.key.split(".").pop().toUpperCase()}</span>
                            <small>
                              {f.preview
                                ? "Open preview"
                                : "Original format · download to view"}
                            </small>
                          </button>
                          <div className="photo-caption">
                            <b title={f.key}>{f.key.split("/").pop()}</b>
                            <small title={f.key}>
                              {f.key.includes("/")
                                ? f.key.slice(0, f.key.lastIndexOf("/"))
                                : "Bucket root"}
                            </small>
                            <div>
                              <span>
                                {bytes(f.size)} · {date(f.modified)}
                              </span>
                              <button
                                title="Download original"
                                onClick={() =>
                                  act(() => api.download(bucket, f.key, f.size))
                                }
                              >
                                <Download size={15} />
                              </button>
                              <button
                                title="Version history"
                                onClick={() => act(() => versions(f.key))}
                              >
                                <History size={15} />
                              </button>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <section className="file-panel">
                      <div className="table-head">
                        <span>Name and folder</span>
                        <span>Size</span>
                        <span>Last modified</span>
                        <span>Actions</span>
                      </div>
                      {library.map((f) => (
                        <div className="file-row" key={f.key}>
                          <span className="file-name">
                            <span className="file-icon">
                              <FileText size={19} />
                            </span>
                            <span title={f.key}>{f.key}</span>
                          </span>
                          <span>{bytes(f.size)}</span>
                          <span>{date(f.modified)}</span>
                          <div className="row-actions">
                            <button
                              title="Download"
                              onClick={() =>
                                act(() => api.download(bucket, f.key, f.size))
                              }
                            >
                              <Download size={15} />
                            </button>
                            <button
                              title="Versions"
                              onClick={() => act(() => versions(f.key))}
                            >
                              <History size={15} />
                            </button>
                            <button
                              title="Private link"
                              onClick={() =>
                                act(async () =>
                                  setToast(await api.share(bucket, f.key)),
                                )
                              }
                            >
                              <Link size={15} />
                            </button>
                            <button
                              title="Delete file"
                              disabled={!!f.transfer}
                              onClick={() =>
                                act(async () => {
                                  if (await api.remove(bucket, f.key))
                                    await loadCatalog();
                                })
                              }
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </section>
                  )}
                  {catalogBusy && (
                    <section className="card">
                      <Empty
                        icon={LoaderCircle}
                        title="Reading your bucket…"
                        text="Files are listed from Backblaze B2."
                      />
                    </section>
                  )}
                  {!catalogBusy && !library.length && (
                    <section className="card">
                      <Empty
                        icon={page === "photos" ? ImageIcon : FileText}
                        title={
                          catalog.next
                            ? "No matches in scanned objects yet"
                            : "No matching files"
                        }
                        text={
                          catalog.next
                            ? "Load more to scan the rest of your bucket."
                            : "Try another folder, search, or bucket."
                        }
                      />
                    </section>
                  )}
                  {catalog.next && (
                    <div className="load-more">
                      <button
                        className="primary"
                        disabled={catalogBusy}
                        onClick={() => act(() => loadCatalog(true))}
                      >
                        Scan next 1,000 objects
                      </button>
                    </div>
                  )}
                  <p className="footnote">
                    Categories use filename extensions, not content inspection.
                    HEIC and camera RAW are included in Photos. Previews load
                    the original image from B2 and may incur transfer usage. A
                    count is complete only after the bucket scan finishes.
                  </p>
                </>
              )}
            </>
          )}
          {page === "settings" && (
            <>
              <PageTitle
                title="A direct connection."
                subtitle="Just two details from Backblaze. No endpoint or region to enter."
              />
              <div className="settings-grid">
                <section className="card">
                  <div className="card-heading">
                    <Cloud size={22} />
                    <div>
                      <h2>Backblaze B2</h2>
                      <p>Connect once. Stay signed in.</p>
                    </div>
                    <span className="pill">
                      {state.connected ? "CONNECTED" : "SETUP"}
                    </span>
                  </div>
                  {state.connected && !state.connectionEditing ? (
                    <div className="connection-locked">
                      <Lock size={25} />
                      <h2>Connection saved and locked</h2>
                      <label>
                        Application Key ID
                        <input
                          disabled
                          value={state.connection?.keyId || "Saved key"}
                        />
                      </label>
                      <label>
                        Application Key
                        <input
                          disabled
                          type="password"
                          value="saved-key-hidden"
                        />
                      </label>
                      <p>
                        Your secret stays encrypted on this Mac. Temporary
                        network loss never clears it.
                      </p>
                      <div className="form-actions">
                        <button onClick={() => act(() => api.editConnection())}>
                          Change connection
                        </button>
                        <button onClick={() => act(() => api.disconnect())}>
                          Disconnect
                        </button>
                      </div>
                    </div>
                  ) : (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        setBusy(true);
                        act(async () => {
                          const r = await api.connect(form);
                          setState(r.state);
                          setBuckets(r.buckets);
                          setBucket(r.buckets[0]?.Name || "");
                          setPrefix("");
                          setForm((f) => ({ ...f, applicationKey: "" }));
                          setPage("files");
                          setToast("Connected. Your buckets are ready.");
                        }).finally(() => setBusy(false));
                      }}
                    >
                      <label>
                        Application Key ID
                        <input
                          required
                          autoComplete="off"
                          placeholder="Your application key ID"
                          value={form.keyId}
                          onChange={(e) =>
                            setForm({ ...form, keyId: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Application Key
                        <input
                          required
                          type="password"
                          autoComplete="off"
                          placeholder="Your secret application key"
                          value={form.applicationKey}
                          onChange={(e) =>
                            setForm({ ...form, applicationKey: e.target.value })
                          }
                        />
                      </label>
                      {needsBucket && (
                        <label>
                          Bucket name
                          <input
                            required
                            placeholder="Your bucket name"
                            value={form.bucket}
                            onChange={(e) =>
                              setForm({ ...form, bucket: e.target.value })
                            }
                          />
                        </label>
                      )}
                      <p className="footnote" style={{ marginBottom: 20 }}>
                        Endpoint and buckets are detected automatically. Your
                        connection is saved securely on this Mac.
                      </p>
                      <div className="form-actions">
                        <button className="primary" disabled={busy || !api}>
                          {busy ? (
                            <LoaderCircle size={17} className="spin" />
                          ) : (
                            <Cloud size={17} />
                          )}
                          Connect account
                        </button>
                        {state.connectionEditing && (
                          <button
                            type="button"
                            onClick={() =>
                              act(() => api.cancelConnectionEdit())
                            }
                          >
                            Cancel change
                          </button>
                        )}
                        {state.connected && (
                          <button
                            type="button"
                            onClick={() => act(() => api.disconnect())}
                          >
                            Disconnect
                          </button>
                        )}
                      </div>
                    </form>
                  )}
                </section>
                <div>
                  <section className="card guide">
                    <ShieldCheck size={25} />
                    <h2>Connect in two details.</h2>
                    <button onClick={() => act(() => api.openKeys())}>
                      Open Backblaze Application Keys <ArrowUpRight size={14} />
                    </button>
                    <p>
                      Create a dedicated B2 Application Key with access to your
                      chosen buckets. Paste its Key ID and Application Key here;
                      BlazeSync finds the endpoint and bucket names for you.
                    </p>
                    <p>
                      Browsing needs read/list access. Upload, backup, restore
                      and deletion need their corresponding write permissions.
                    </p>
                    <p>
                      Credentials are encrypted using macOS protected storage.
                      They are never sent to an app server.
                    </p>
                  </section>
                  <section className="card guide">
                    <Clock size={22} />
                    <h2>Cloud refresh</h2>
                    <label>
                      Check for changes made in Backblaze
                      <select
                        value={state.refreshSeconds ?? 15}
                        onChange={(e) =>
                          act(() => api.setRefresh(Number(e.target.value)))
                        }
                      >
                        <option value={15}>Every 15 seconds</option>
                        <option value={30}>Every 30 seconds</option>
                        <option value={60}>Every minute</option>
                        <option value={0}>Manual only</option>
                      </select>
                    </label>
                    <p>
                      Refresh checks cloud listings. This is separate from
                      one-way folder backups.
                    </p>
                    <h2>Know what runs.</h2>
                    <p>
                      Scheduled backups run while BlazeSync is open and your Mac
                      is awake. Backup uploads changed files; it does not remove
                      cloud files when you delete local ones.
                    </p>
                    <p>
                      Version recovery depends on your bucket retention rules.
                      Storage and transfer charges are billed by Backblaze.
                    </p>
                  </section>
                </div>
              </div>
            </>
          )}
          {page === "transfers" && (
            <>
              <PageTitle
                title="Every move, visible."
                subtitle="Follow uploads and downloads. Successful transfers include a file-size check."
              />
              <section className="card">
                {state.transfers.length ? (
                  state.transfers.map((t) => (
                    <div className="transfer" key={t.id}>
                      <div className="file-icon">
                        {t.type === "upload" ? (
                          <Upload size={20} />
                        ) : (
                          <Download size={20} />
                        )}
                      </div>
                      <div className="transfer-info">
                        <b>{t.key}</b>
                        <small>
                          {t.bucket} · {t.type} · {t.error || t.status}
                          {t.batch && ` · ${t.completed}/${t.total} items`}
                          {t.batch && t.skipped > 0 && ` · ${t.skipped} unchanged`}
                          {t.phase === "hashing" && ` · Checking local file ${bytes(t.checked || 0)} / ${bytes(t.size)}`}
                        </small>
                        <div className="progress">
                          <i
                            style={{
                              width:
                                (t.size
                                  ? Math.min(100, (t.loaded / t.size) * 100)
                                  : t.status === "done"
                                    ? 100
                                    : 0) + "%",
                            }}
                          />
                        </div>
                      </div>
                      <span>
                        {bytes(t.loaded)} / {bytes(t.size)}
                        <small>
                          {t.status === "running"
                            ? `${bytes(t.speed || 0)}/s${t.eta ? ` · ${Math.ceil(t.eta)}s left` : ""}`
                            : t.status}
                        </small>
                      </span>
                      {["queued", "running"].includes(t.status) ? (
                        <button
                          title={t.batch ? "Cancel entire transfer batch" : "Cancel"}
                          onClick={() => act(() => api.cancel(t.id))}
                        >
                          <X size={18} />
                        </button>
                      ) : t.status === "done" ? (
                        <Check className="success" size={19} />
                      ) : (
                        <AlertCircle size={19} />
                      )}
                    </div>
                  ))
                ) : (
                  <Empty
                    icon={ArrowDownUp}
                    title="Nothing moving yet"
                    text="Your uploads and downloads will appear here."
                  />
                )}
              </section>
              <p className="footnote">
                Interrupted transfers need to be selected again. Transfer
                history is kept for this app session.
              </p>
            </>
          )}
          {page === "backups" && (
            <>
              <div className="page-heading">
                <div>
                  <h1>A little peace of mind.</h1>
                  <p>
                    One-way folder backups. Local deletions never delete cloud
                    copies.
                  </p>
                </div>
                <button
                  className="primary"
                  disabled={!bucket || !state.connected}
                  onClick={() => setModal("backup")}
                >
                  <Plus size={17} />
                  Add folder backup
                </button>
                <button
                  disabled={!bucket || !state.connected}
                  onClick={() =>
                    act(async () => {
                      const job = await api.addFolderSync(bucket, prefix);
                      if (job)
                        setToast(
                          "Folder sync enabled. New and changed files upload to the same destination.",
                        );
                    })
                  }
                >
                  <RefreshCw size={17} /> Add folder sync
                </button>
                <button
                  onClick={() =>
                    act(async () => {
                      await api.installFinderSync();
                      setToast(
                        "Finder Quick Action installed. Right-click a folder, then Services or Quick Actions → Sync with BlazeSync.",
                      );
                    })
                  }
                >
                  {state.finderSyncInstalled
                    ? "Refresh Finder sync"
                    : "Enable Finder sync"}
                </button>
              </div>
              <div className="info-strip">
                <Clock size={18} />
                Keep BlazeSync open and your Mac awake for scheduled backups.
                New jobs start on the next 30-second check.
              </div>
              {state.jobs.length ? (
                state.jobs.map((j) => (
                  <section className="card backup-card" key={j.id}>
                    <div className="card-heading">
                      <div className="file-icon folder-icon">
                        <Folder size={24} />
                      </div>
                      <div>
                        <h2>
                          {j.name}
                          {j.kind === "sync" ? " · Folder sync" : ""}
                        </h2>
                        <p>{j.folder}</p>
                      </div>
                      <span className="pill">
                        {j.running
                          ? "RUNNING"
                          : j.enabled
                            ? "SCHEDULED"
                            : "PAUSED"}
                      </span>
                    </div>
                    <div className="backup-details">
                      <div>
                        <small>DESTINATION</small>
                        <p>
                          {j.bucket}/{j.prefix}
                        </p>
                      </div>
                      <div>
                        <small>FREQUENCY</small>
                        <p>
                          Every{" "}
                          {j.interval === 1440
                            ? "day"
                            : j.interval === 60
                              ? "hour"
                              : "5 minutes"}
                        </p>
                      </div>
                      <div>
                        <small>LAST SUCCESS</small>
                        <p>{date(j.lastSuccess)}</p>
                      </div>
                    </div>
                    {j.lastSuccess && (
                      <p>
                        {j.lastUploaded ?? 0} uploaded · {j.lastSkipped ?? 0}{" "}
                        unchanged items skipped
                      </p>
                    )}
                    {j.error && <p className="error-text">{j.error}</p>}
                    <div className="form-actions">
                      <button
                        disabled={j.running || !state.connected}
                        onClick={() => act(() => api.runBackup(j.id))}
                      >
                        <Play size={15} />
                        {j.kind === "sync" ? "Sync now" : "Run now"}
                      </button>
                      <button
                        onClick={() => act(() => api.openSyncFolder(j.id))}
                      >
                        Open local folder
                      </button>
                      <button onClick={() => act(() => api.toggleBackup(j.id))}>
                        {j.enabled ? <Pause size={15} /> : <Play size={15} />}{" "}
                        {j.enabled ? "Pause schedule" : "Enable schedule"}
                      </button>
                      <button
                        disabled={j.running}
                        onClick={() => {
                          if (
                            confirm(
                              "Remove this backup schedule? Cloud files will be kept.",
                            )
                          )
                            act(() => api.removeBackup(j.id));
                        }}
                      >
                        <Trash2 size={15} />
                        Remove schedule
                      </button>
                    </div>
                  </section>
                ))
              ) : (
                <section className="card">
                  <Empty
                    icon={ShieldCheck}
                    title="Your next good habit"
                    text="Choose a folder to automatically upload new and changed files."
                  />
                </section>
              )}
              <p className="footnote">
                Sync compares file content, including files uploaded before
                content hashes were added. Symlinks are skipped. This is a file
                backup, not a full system snapshot. Renamed files keep their
                older cloud copies.
              </p>
            </>
          )}
          {page === "activity" && (
            <>
              <PageTitle
                title="The story of your storage."
                subtitle="Connection, backup and file activity from this session."
              />
              <section className="card">
                {state.events.length ? (
                  state.events.map((e) => (
                    <div className="activity" key={e.id}>
                      <span className="event-dot" />
                      <div>
                        {e.message}
                        <small>{date(e.at)}</small>
                      </div>
                    </div>
                  ))
                ) : (
                  <Empty
                    icon={History}
                    title="A clean slate"
                    text="Activity will appear as you use your workspace."
                  />
                )}
              </section>
            </>
          )}
        </main>
        <footer>
          <span>
            <Cloud size={14} /> BlazeSync · Personal storage
          </span>
          <span>
            Local desktop app <span className="dot green" />
          </span>
        </footer>
      </div>
      {modal && (
        <div className="overlay">
          <section className="modal">
            <button className="close" onClick={closeModal}>
              <X size={20} />
            </button>
            {modal === "manage" && (
              <>
                <h2>
                  {manageMode === "rename"
                    ? "Rename item"
                    : "Move selected items"}
                </h2>
                <p>{manageEntries.map((entry) => entry.key).join(", ")}</p>
                <form onSubmit={submitManagement}>
                  {manageMode === "rename" ? (
                    <label>
                      New name
                      <input
                        autoFocus
                        required
                        value={newName}
                        onChange={(event) => setNewName(event.target.value)}
                      />
                    </label>
                  ) : (
                    <>
                      <label>
                        Destination bucket
                        <select
                          value={destinationBucket}
                          onChange={(event) =>
                            setDestinationBucket(event.target.value)
                          }
                        >
                          {buckets.map((item) => (
                            <option key={item.Name} value={item.Name}>
                              {item.Name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Destination folder path
                        <input
                          value={destinationPrefix}
                          onChange={(event) =>
                            setDestinationPrefix(event.target.value)
                          }
                          placeholder="Projects/2026/ · leave empty for bucket root"
                        />
                      </label>
                    </>
                  )}
                  <p className="footnote">
                    Copies are verified before sources are removed. Existing
                    destination files require overwrite confirmation. Backblaze
                    may retain older versions that continue using storage.
                  </p>
                  <button
                    className="primary"
                    disabled={managing || !!state.fileOperation}
                  >
                    {managing ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <FolderInput size={16} />
                    )}
                    Review {manageMode === "rename" ? "rename" : "move"}
                  </button>
                </form>
              </>
            )}
            {modal === "folder" && (
              <>
                <h2>A place for something new.</h2>
                <p>
                  Create a folder in {bucket}/{prefix}
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(async () => {
                      await api.mkdir(bucket, prefix, folderName);
                      setModal(null);
                      await load();
                    });
                  }}
                >
                  <label>
                    Folder name
                    <input
                      autoFocus
                      required
                      value={folderName}
                      onChange={(e) => setFolderName(e.target.value)}
                    />
                  </label>
                  <button className="primary">Create folder</button>
                </form>
              </>
            )}
            {modal === "backup" && (
              <>
                <h2>Keep a folder backed up.</h2>
                <p>
                  A separate backup folder will be created inside {bucket}/
                  {prefix || "the bucket root"}.
                </p>
                <label>
                  Backup frequency
                  <select
                    value={interval}
                    onChange={(e) => setIntervalValue(Number(e.target.value))}
                  >
                    <option value={5}>Every 5 minutes</option>
                    <option value={60}>Every hour</option>
                    <option value={1440}>Every day</option>
                  </select>
                </label>
                <p className="footnote">
                  Files in the selected folder and its subfolders will upload
                  automatically. Hidden files are included, except .DS_Store.
                  Choose a folder that contains only what you intend to back up.
                </p>
                <button
                  className="primary"
                  onClick={() =>
                    act(async () => {
                      const j = await api.addBackup(bucket, prefix, interval);
                      if (j) {
                        setModal(null);
                        setPage("backups");
                      }
                    })
                  }
                >
                  <Folder size={17} />
                  Choose folder
                </button>
              </>
            )}
            {modal === "preview" && previewFile && (
              <>
                <h2>{previewFile.key.split("/").pop()}</h2>
                <p className="break">
                  {previewFile.key} · {bytes(previewFile.size)}
                </p>
                {previewFile.preview ? (
                  previewUrl ? (
                    <img
                      className="photo-preview"
                      src={previewUrl}
                      alt={previewFile.key}
                      onError={() =>
                        setError(
                          "This image could not be previewed. Download the original to view it.",
                        )
                      }
                    />
                  ) : (
                    <p>Loading image…</p>
                  )
                ) : (
                  <div className="empty">
                    <ImageIcon size={40} />
                    <h3>Keep the original quality.</h3>
                    <p>
                      This format needs an external viewer. Download the
                      original to open it.
                    </p>
                  </div>
                )}
                <button
                  className="primary"
                  onClick={() =>
                    act(() => api.download(previewFile.bucket, previewFile.key, previewFile.size))
                  }
                >
                  <Download size={16} />
                  Download original
                </button>
                <p className="footnote">
                  The original image is downloaded for preview. This uses your
                  B2 bandwidth.
                </p>
              </>
            )}
            {modal === "versions" && (
              <>
                <h2>Version history</h2>
                <p className="break">{versionKey}</p>
                <div className="history-notice">
                  <p>
                    Deleting current files hides them. Stored versions remain in
                    Backblaze until purged or expired by lifecycle rules.
                  </p>
                </div>
                <button
                  className="danger-action"
                  onClick={() =>
                    act(async () => {
                      const result = await api.purgeFile(
                        versionBucket,
                        versionKey,
                      );
                      if (result) {
                        setModal(null);
                        setToast(
                          "Backblaze confirmed all versions were deleted.",
                        );
                      }
                    })
                  }
                >
                  <Trash2 size={16} />
                  Permanently delete all versions
                </button>
                {versionData?.versions.map((v) => (
                  <div className="version" key={v.id}>
                    <div>
                      <b>
                        {date(v.modified)}{" "}
                        {v.latest && <span className="pill">CURRENT</span>}
                      </b>
                      <small>
                        {bytes(v.size)} · {v.id}
                      </small>
                    </div>
                    <button
                      disabled={v.latest}
                      onClick={() =>
                        act(async () => {
                          if (
                            await api.restore(versionBucket, versionKey, v.id)
                          ) {
                            await versions(versionKey, false, versionBucket);
                            await load();
                            setToast("Version restored as the current file.");
                          }
                        })
                      }
                    >
                      Restore
                    </button>
                  </div>
                ))}
                {versionData?.markers.map((v) => (
                  <p key={v.id} className="footnote">
                    Delete marker · {date(v.modified)}{" "}
                    {v.latest ? "· current" : ""}
                  </p>
                ))}
                {!versionData?.versions.length && (
                  <p>No stored versions were returned.</p>
                )}
                {versionData?.next && (
                  <button
                    onClick={() =>
                      act(() => versions(versionKey, true, versionBucket))
                    }
                  >
                    Load more versions
                  </button>
                )}
                <p className="footnote">
                  Restoring creates a new current copy. Older versions depend on
                  your B2 lifecycle rules.
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function Stat({ icon: Icon, label, value, note }) {
  return (
    <div className="stat">
      <div>
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
function PageTitle({ title, subtitle }) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}
function Empty({ icon: Icon, title, text }) {
  return (
    <div className="empty">
      <Icon size={35} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
