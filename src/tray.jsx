import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowDownUp,
  Settings,
  Power,
  Image,
  CheckCircle,
  Cloud,
  File,
  ShieldCheck,
} from "lucide-react";
import logo from "./logo.svg";
import "./tray.css";
function Panel() {
  const [dropError, setDropError] = useState(""),
    [dragging, setDragging] = useState(false);
  const [state, setState] = useState({ transfers: [], jobs: [], events: [] });
  useEffect(() => {
    window.vault.state().then(setState);
    return window.vault.onUpdate(setState);
  }, []);
  const active = state.transfers.filter((t) =>
    ["running", "queued"].includes(t.status),
  ).length;
  const go = (page) => window.vault.openPage(page);
  useEffect(() => {
    document.documentElement.dataset.theme = state.dark ? "dark" : "light";
  }, [state.dark]);
  const target = state.uploadTarget;
  return (
    <div
      className={"panel " + (dragging ? "dragging" : "")}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDragging(false);
        try {
          if (!target) throw new Error("Open a bucket in the full app first.");
          await window.vault.uploadDropped(
            [...e.dataTransfer.files],
            target.bucket,
            target.prefix,
          );
          setDropError("");
        } catch (error) {
          setDropError(error.message);
        }
      }}
    >
      <div className="drop-hint">
        {dragging
          ? "Drop to upload"
          : target
            ? "Drop files / folders into " + target.bucket + "/" + target.prefix
            : "Open a bucket to choose a drop destination"}
      </div>
      {dropError && <p className="drop-error">{dropError}</p>}
      <header>
        <img alt="BlazeSync logo" src={logo} />
        <div>
          <strong>BlazeSync</strong>
          <small>Your personal cloud</small>
        </div>
        <button title="Settings" onClick={() => go("settings")}>
          <Settings size={18} />
        </button>
      </header>
      <div className="connection">
        <span
          className={
            state.connected && state.health === "online" ? "online" : ""
          }
        />
        {state.connected
          ? {
              online: "Connected to Backblaze B2",
              offline: "Offline · reconnecting automatically",
              checking: "Checking saved connection…",
              "key-error": "Key needs attention",
              attention: "Check bucket permissions",
            }[state.health] || "Connection saved"
          : "Connect your Backblaze B2 account"}
      </div>
      <div className="summary">
        <div>
          <ArrowDownUp size={17} />
          <b>{active}</b>
          <small>Active transfers</small>
        </div>
        <div>
          <ShieldCheck size={17} />
          <b>{state.jobs.filter((j) => j.enabled).length}</b>
          <small>Scheduled backups</small>
        </div>
      </div>
      <nav>
        <button onClick={() => go("library")}>
          <File size={16} />
          Files
        </button>
        <button onClick={() => go("photos")}>
          <Image size={16} />
          Photos
        </button>
        <button onClick={() => go("backups")}>
          <ShieldCheck size={16} />
          Backups
        </button>
        <button onClick={() => go("transfers")}>
          <ArrowDownUp size={16} />
          Transfers
        </button>
      </nav>
      <section>
        <h3>RECENT TRANSFERS</h3>
        {state.transfers.length ? (
          state.transfers.slice(0, 4).map((t) => (
            <div className="recent" key={t.id}>
              <Cloud size={18} />
              <div>
                <b>{t.key.split("/").pop()}</b>
                <small>
                  {t.status}
                  {t.status === "running"
                    ? ` · ${((t.speed || 0) / 1000 / 1000).toFixed(1)} MB/s`
                    : ""}
                  {t.error ? " · " + t.error : ""}
                </small>
              </div>
              {t.status === "done" && (
                <CheckCircle size={15} className="green" />
              )}
            </div>
          ))
        ) : (
          <div className="no-transfers">
            <Cloud size={27} />
            <p>Your next move starts here.</p>
            <small>Transfers will appear as you use BlazeSync.</small>
          </div>
        )}
      </section>
      <button className="open-app" onClick={() => go("files")}>
        Open BlazeSync <ArrowUpRight size={17} />
      </button>
      <footer>
        <span>Runs until you choose Quit</span>
        <button onClick={() => window.vault.quit()}>
          <Power size={13} />
          Quit BlazeSync
        </button>
      </footer>
    </div>
  );
}
createRoot(document.getElementById("tray-root")).render(<Panel />);
